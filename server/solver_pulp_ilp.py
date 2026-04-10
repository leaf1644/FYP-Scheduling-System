import json
import re
import sys
from collections import defaultdict
from pulp import (
    LpMaximize,
    LpProblem,
    LpVariable,
    lpSum,
    PULP_CBC_CMD,
    LpStatus,
)
from faculty_priority import (
    build_professor_priority_context,
    calculate_weighted_soft_cost,
    count_professor_student_loads,
    get_preference_weight,
)


ILP_TWO_PHASE_MAX_STUDENTS = 80
ILP_TWO_PHASE_MAX_ASSIGNMENT_VARIABLES = 4000
ILP_TWO_PHASE_MAX_PREFERENCE_COUNT = 8


def read_payload():
    """Read the normalized scheduling payload from stdin.

    The frontend already prepares a common JSON structure for every solver. This
    helper only needs to deserialize that JSON into a Python dictionary. If stdin
    is empty, it returns an empty payload so the caller can fail gracefully.
    """
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def get_date_from_slot(label: str) -> str:
    """Extract the day portion from a slot label.

    Soft preferences are evaluated at the day level, not the exact minute-level
    room-slot level. This function removes the trailing time range and keeps only
    the date or logical day prefix, such as "10 April (Fri)" or "Day 2".
    """
    normalized = re.sub(r"[–—]", "-", label).strip()
    match = re.match(
        r"^(.*?)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$",
        normalized,
        re.IGNORECASE,
    )
    if match and match.group(1).strip():
        return match.group(1).strip()

    day_match = re.search(r"Day\s+\d+", normalized, re.IGNORECASE)
    if day_match:
        return day_match.group(0)

    return normalized


def calculate_soft_cost(assignments, students, prof_preferences, professor_priority_context):
    """Compute the weighted soft-preference penalty of a finished schedule.

    The solver optimizes internally using MILP variables, but the UI only needs a
    summary score for the produced schedule. This helper converts assignments into
    day-based records and passes them to the shared faculty-priority utility.
    """
    assignment_records = [
        {
            "student": assignment["student"],
            "day": get_date_from_slot(assignment["roomSlot"]["timeLabel"]),
        }
        for assignment in assignments
    ]
    return calculate_weighted_soft_cost(
        assignment_records,
        prof_preferences,
        professor_priority_context,
        prioritize_faculty=False,
    )


def build_solver(timeout_seconds):
    """Create the CBC backend with the chosen runtime settings.

    The ILP model is solved through PuLP using the CBC backend. This helper keeps
    all solver runtime parameters in one place, including time limit and thread
    count, so both optimization phases behave consistently.
    """
    solver_options = [
        f"-sec {timeout_seconds:.1f}",
        "-threads 8",
    ]
    return PULP_CBC_CMD(
        timeLimit=timeout_seconds,
        threads=8,
        msg=0,
        options=solver_options,
    )


def has_feasible_solution(status, variables):
    """Check whether CBC produced a usable schedule solution.

    Solver status strings alone are not always enough for the UI. This helper
    treats the result as usable if the status is acceptable or if at least one
    decision variable received a value, unless the model is explicitly infeasible
    or unbounded.
    """
    if LpStatus[status] in ("Infeasible", "Unbounded"):
        return False
    return status == 1 or any(var.varValue is not None for var in variables.values())


def should_enable_two_phase_soft_optimization(students, assignment_variable_count, preference_count):
    """Decide whether the soft-optimization second phase is affordable.

    Two-phase optimization improves preference quality, but on very large ILP
    models it can become too expensive. This gate keeps the second phase enabled
    only when the number of students, assignment variables, and preferences stays
    within practical limits.
    """
    if preference_count <= ILP_TWO_PHASE_MAX_PREFERENCE_COUNT:
        return True
    return len(students) <= ILP_TWO_PHASE_MAX_STUDENTS and assignment_variable_count <= ILP_TWO_PHASE_MAX_ASSIGNMENT_VARIABLES


def main():
    """Build and solve the scheduling problem as a binary ILP model.

    High-level flow:
    1. Read normalized payload.
    2. Build feasible domains and binary decision variables.
    3. Add hard linear constraints.
    4. Build optional soft-penalty variables and constraints.
    5. Run phase one to maximize coverage.
    6. Optionally run phase two to improve preference quality.
    7. Convert selected binary variables into assignments and unscheduled cases.
    """
    payload = read_payload()
    students = payload.get("students", [])
    all_room_slots = payload.get("allRoomSlots", [])
    prof_availability = payload.get("profAvailability", {})
    prof_preferences = payload.get("profPreferences", {})
    professor_priority_context = build_professor_priority_context(students)
    timeout_ms = payload.get("timeoutMs", 120000)
    if timeout_ms is None:
        timeout_ms = 120000
    else:
        timeout_ms = int(timeout_ms)
    timeout_ms = max(500, min(120000, timeout_ms))
    timeout_seconds = timeout_ms / 1000

    # 建立 MILP 模型
    prob = LpProblem("scheduling_problem", LpMaximize)

    # Decision variables: x[i, j] = 1 means student i is assigned to room-slot j.
    x = {}
    student_domains = []
    professor_day_to_vars = defaultdict(list)
    slot_day_by_slot_id = {
        room_slot["slotId"]: get_date_from_slot(room_slot.get("timeLabel", ""))
        for room_slot in all_room_slots
    }
    all_days = sorted(set(slot_day_by_slot_id.values()))

    # Step 1: Build the feasible domain for every student by keeping only the
    # room-slots where both the supervisor and observer are available.
    for student_index, student in enumerate(students):
        sup_slots = set(prof_availability.get(student["supervisorId"], []))
        obs_slots = set(prof_availability.get(student["observerId"], []))
        domain = []

        for room_slot_index, room_slot in enumerate(all_room_slots):
            room_slot_id = room_slot["slotId"]
            if room_slot_id in sup_slots and room_slot_id in obs_slots:
                domain.append(room_slot_index)
                # Create one binary variable for this feasible assignment pair.
                var_name = f"x_{student_index}_{room_slot_index}"
                x[(student_index, room_slot_index)] = LpVariable(var_name, cat="Binary")
                day = slot_day_by_slot_id.get(room_slot_id, room_slot.get("timeLabel", ""))
                professor_day_to_vars[(student["supervisorId"], day)].append(x[(student_index, room_slot_index)])
                professor_day_to_vars[(student["observerId"], day)].append(x[(student_index, room_slot_index)])

        student_domains.append(domain)

    assignment_count = lpSum([x[key] for key in x.keys()])

    # Hard constraint A: each student can be assigned to at most one slot.
    for student_index in range(len(students)):
        vars_for_student = [x[(student_index, room_slot_index)] 
                           for room_slot_index in student_domains[student_index]]
        if vars_for_student:
            prob += lpSum(vars_for_student) <= 1, f"max_one_slot_per_student_{student_index}"

    # Hard constraint B: each room-slot can host at most one student.
    room_slot_to_vars = defaultdict(list)
    for (student_index, room_slot_index), var in x.items():
        room_slot_to_vars[room_slot_index].append(var)

    for room_slot_index, vars_for_room_slot in room_slot_to_vars.items():
        prob += lpSum(vars_for_room_slot) <= 1, f"max_one_student_per_slot_{room_slot_index}"

    # Hard constraint C: a professor cannot appear in more than one presentation
    # in the same logical slot.
    professor_slot_to_vars = {}
    for (student_index, room_slot_index), var in x.items():
        student = students[student_index]
        room_slot = all_room_slots[room_slot_index]
        
        # 指導教授時段衝突
        sup_key = (student["supervisorId"], room_slot["slotId"])
        if sup_key not in professor_slot_to_vars:
            professor_slot_to_vars[sup_key] = []
        professor_slot_to_vars[sup_key].append(var)
        
        # 口試教授時段衝突
        obs_key = (student["observerId"], room_slot["slotId"])
        if obs_key not in professor_slot_to_vars:
            professor_slot_to_vars[obs_key] = []
        professor_slot_to_vars[obs_key].append(var)

    for (prof_id, slot_id), vars_for_prof_slot in professor_slot_to_vars.items():
        prob += (
            lpSum(vars_for_prof_slot) <= 1,
            f"prof_conflict_{prof_id}_{slot_id}"
        )

    enable_two_phase_soft_optimization = bool(prof_preferences) and should_enable_two_phase_soft_optimization(students, len(x), len(prof_preferences))

    soft_penalty_terms = []
    soft_penalty_upper_bound = 0
    if enable_two_phase_soft_optimization:
        # Soft penalties do not affect validity. They only decide which valid
        # schedule is preferable when there are multiple feasible solutions.
        professor_loads = count_professor_student_loads(students)
        for professor_id, pref in prof_preferences.items():
            pref_type = pref.get("type", "CONCENTRATE")
            effective_weight = get_preference_weight(
                professor_id,
                prof_preferences,
                professor_priority_context,
                prioritize_faculty=True,
            )

            day_used_vars = []
            # day_used is a binary helper variable that becomes 1 when the
            # professor is used at least once on that day.
            for day in all_days:
                day_vars = professor_day_to_vars.get((professor_id, day), [])
                if not day_vars:
                    continue
                day_used = LpVariable(f"prof_day_used_{professor_id}_{abs(hash(day))}", cat="Binary")
                day_used_vars.append(day_used)
                prob += day_used <= lpSum(day_vars), f"day_used_upper_{professor_id}_{abs(hash(day))}"
                for index, var in enumerate(day_vars):
                    prob += day_used >= var, f"day_used_lower_{professor_id}_{abs(hash(day))}_{index}"

            if pref_type == "CONCENTRATE":
                # Penalize using too many different days for the same professor.
                if day_used_vars:
                    extra_days = LpVariable(f"extra_days_{professor_id}", lowBound=0, upBound=len(day_used_vars), cat="Integer")
                    prob += extra_days >= lpSum(day_used_vars) - 1, f"extra_days_lb_{professor_id}"
                    soft_penalty_terms.append(extra_days * effective_weight)
                    soft_penalty_upper_bound += max(0, len(day_used_vars) - 1) * effective_weight
                continue

            if pref_type == "MAX_PER_DAY":
                # Penalize any number of assignments above the professor's daily limit.
                limit = int(pref.get("target", 3) or 3)
                for day in all_days:
                    day_vars = professor_day_to_vars.get((professor_id, day), [])
                    if not day_vars:
                        continue
                    max_excess = max(0, len(day_vars) - limit)
                    if max_excess == 0:
                        continue
                    excess = LpVariable(f"daily_excess_{professor_id}_{abs(hash(day))}", lowBound=0, upBound=max_excess, cat="Integer")
                    prob += excess >= lpSum(day_vars) - limit, f"daily_excess_lb_{professor_id}_{abs(hash(day))}"
                    soft_penalty_terms.append(excess * effective_weight)
                    soft_penalty_upper_bound += max_excess * effective_weight
                continue

            # SPREAD rewards using enough days by penalizing shortage in the
            # effective number of active days for that professor.
            total_load_expr = lpSum(
                var
                for (student_index, _room_slot_index), var in x.items()
                if professor_id in (
                    students[student_index]["supervisorId"],
                    students[student_index]["observerId"],
                )
            )
            max_shortage = (professor_loads.get(professor_id, 0) + 1) // 2
            if max_shortage > 0:
                shortage = LpVariable(f"spread_shortage_{professor_id}", lowBound=0, upBound=max_shortage, cat="Integer")
                prob += total_load_expr <= 2 * lpSum(day_used_vars) + 2 * shortage, f"spread_shortage_lb_{professor_id}"
                soft_penalty_terms.append(shortage * effective_weight)
                soft_penalty_upper_bound += max_shortage * effective_weight

    phase_one_timeout_seconds = max(0.5, timeout_seconds * 0.4)
    phase_two_timeout_seconds = max(0.5, timeout_seconds - phase_one_timeout_seconds)

    # Phase 1: maximize the number of scheduled students only.
    prob += assignment_count, "maximize_assignments"
    phase_one_status = prob.solve(build_solver(phase_one_timeout_seconds))

    if LpStatus[phase_one_status] == "Infeasible":
        print(json.dumps({"error": "MILP 模型無可行解"}))
        return
    elif LpStatus[phase_one_status] == "Unbounded":
        print(json.dumps({"error": "MILP 模型無界"}))
        return

    if not has_feasible_solution(phase_one_status, x):
        print(json.dumps({"error": f"MILP 求解失敗：{LpStatus[phase_one_status]}"}))
        return

    best_assignment_count = int(round(sum((var.varValue or 0) for var in x.values())))
    phase_one_values = {
        key: (var.varValue or 0)
        for key, var in x.items()
    }

    # Phase 2: keep the best coverage fixed and optimize preference quality.
    # If this second phase fails, fall back to the phase-one solution values.
    if enable_two_phase_soft_optimization and soft_penalty_terms:
        prob += assignment_count == best_assignment_count, "fix_assignment_count_phase_two"
        prob.setObjective(-lpSum(soft_penalty_terms))
        phase_two_status = prob.solve(build_solver(phase_two_timeout_seconds))
        if not has_feasible_solution(phase_two_status, x):
            for key, var in x.items():
                var.varValue = phase_one_values[key]

    # Convert selected binary variables into concrete assignment records.
    assignments = []
    assigned_students = set()

    for (student_index, room_slot_index), var in x.items():
        if var.varValue and var.varValue > 0.5:  # 檢查二元變數值是否為 1
            assigned_students.add(student_index)
            assignments.append({
                "student": students[student_index],
                "roomSlot": all_room_slots[room_slot_index],
            })

    # Build explicit unscheduled explanations so the UI can show a complete result.
    unscheduled = []
    for student_index, student in enumerate(students):
        if student_index in assigned_students:
            continue

        if not student_domains[student_index]:
            unscheduled.append({
                "student": student,
                "reason": "NO_COMMON_TIME",
                "details": "指導教授與口試教授沒有任何共同可用時段。",
            })
        else:
            unscheduled.append({
                "student": student,
                "reason": "PROF_BUSY",
                "details": "可用時段已被其他安排占用，或教授在同時段有衝堂。",
            })

    # Keep the output contract aligned with the other solver backends.
    result = {
        "success": len(unscheduled) == 0,
        "assignments": assignments,
        "unscheduled": unscheduled,
        "softConstraintCost": calculate_soft_cost(assignments, students, prof_preferences, professor_priority_context),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
