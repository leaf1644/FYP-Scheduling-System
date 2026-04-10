import json
import re
import sys
from collections import defaultdict

from ortools.sat.python import cp_model
from faculty_priority import (
    build_professor_priority_context,
    calculate_weighted_soft_cost,
    count_professor_student_loads,
    get_preference_weight,
)


def read_payload():
    """Read the normalized scheduling payload from stdin.

    The frontend or middleware sends JSON that already contains students,
    room-slot nodes, professor availability, preference settings, and timeout.
    This helper keeps the solver entry simple by turning that JSON text into a
    Python dictionary. If stdin is empty, it returns an empty payload so the
    caller can fail gracefully later.
    """
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def get_date_from_slot(label: str) -> str:
    """Extract the day portion from a full slot label.

    Soft constraints such as CONCENTRATE, MAX_PER_DAY, and SPREAD operate on a
    day basis instead of an exact room-slot basis. This function strips the time
    range from labels like "10 April (Fri) 9-11:30am" and keeps only the date or
    logical day prefix. If the label does not match the common date-time pattern,
    it falls back to patterns like "Day 1" and finally returns the original text.
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
    """Evaluate the soft-preference quality of a finished schedule.

    The solver itself optimizes using internal CP-SAT variables, but the final UI
    only needs a summarized soft-cost value. This function converts concrete
    assignments back into a simplified day-based record format expected by the
    shared faculty-priority helper, then returns the weighted preference penalty.
    Lower values mean the schedule matches professor preferences better.
    """
    # Convert concrete room-slot assignments into day-based records used by the shared soft-cost helper.
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


def configure_solver(solver, timeout_seconds):
    """Apply CP-SAT search parameters used by both optimization phases.

    This keeps phase-one and phase-two solver instances consistent. The settings
    here define the time limit, enable parallel workers, use portfolio search,
    and keep deterministic seeds where possible. Even with a fixed seed, the
    combination of portfolio search and multi-worker execution can still produce
    different but valid solutions across runs.
    """
    solver.parameters.max_time_in_seconds = timeout_seconds
    solver.parameters.num_search_workers = 16
    solver.parameters.log_search_progress = False
    solver.parameters.cp_model_presolve = True
    solver.parameters.linearization_level = 2
    solver.parameters.search_branching = cp_model.PORTFOLIO_SEARCH
    solver.parameters.use_absl_random = True
    solver.parameters.random_seed = 42
    solver.parameters.interleave_search = True


def collect_assignments(solver, student_vars, students, all_room_slots):
    """Convert solved Boolean variables back into real schedule assignments.

    student_vars maps each feasible (student, room-slot) pair to one Boolean CP
    variable. After solving, any variable with value 1 means that pair has been
    selected. This helper turns those selected pairs into the app's output shape
    and also tracks which students have already been assigned so the remaining
    students can later be classified as unscheduled.
    """
    assignments = []
    assigned_students = set()

    for (student_index, room_slot_index), var in student_vars.items():
        if solver.Value(var) != 1:
            continue

        assigned_students.add(student_index)
        assignments.append({
            "student": students[student_index],
            "roomSlot": all_room_slots[room_slot_index],
        })

    return assignments, assigned_students


def main():
    """Build and solve the CP-SAT scheduling model from top to bottom.

    High-level flow:
    1. Read normalized input payload.
    2. Build feasible domains for every student.
    3. Create Boolean decision variables for feasible assignments only.
    4. Add hard constraints for student uniqueness, room-slot uniqueness, and
       professor conflict prevention.
    5. Build optional soft-preference penalty terms.
    6. Run two-phase optimization: maximize coverage first, then minimize soft
       penalties without reducing that best coverage.
    7. Convert the selected variables into assignments and generate unscheduled
       reasons for the remaining students.
    """
    payload = read_payload()
    students = payload.get("students", [])
    all_room_slots = payload.get("allRoomSlots", [])
    prof_availability = payload.get("profAvailability", {})
    prof_preferences = payload.get("profPreferences", {})
    professor_priority_context = build_professor_priority_context(students)
    
    # 優化 1: 將 timeout_ms 預設改為 20000，允許最大調整至 120000
    timeout_ms = payload.get("timeoutMs", 20000)
    if timeout_ms is None:
        timeout_ms = 20000
    else:
        timeout_ms = int(timeout_ms)
    timeout_ms = max(500, min(120000, timeout_ms))  # 限制在 500-120000 毫秒內

    model = cp_model.CpModel()
    student_domains = []
    student_vars = {}
    room_slot_to_vars = defaultdict(list)
    professor_slot_to_vars = defaultdict(list)
    professor_day_to_vars = defaultdict(list)
    slot_day_by_slot_id = {
        room_slot["slotId"]: get_date_from_slot(room_slot.get("timeLabel", ""))
        for room_slot in all_room_slots
    }
    all_days = sorted(set(slot_day_by_slot_id.values()))

    # Step 1: For each student, build the feasible domain by keeping only the
    # room-slot combinations where both required professors are available.
    for student_index, student in enumerate(students):
        # 先收斂每位學生的候選 domain，只保留兩位教授都可出席的 room-slot。
        sup_slots = set(prof_availability.get(student["supervisorId"], []))
        obs_slots = set(prof_availability.get(student["observerId"], []))
        domain = []

        for room_slot_index, room_slot in enumerate(all_room_slots):
            room_slot_id = room_slot["slotId"]
            
            # 檢查該房間時段是否被兩個教授都標記為可用
            sup_available = room_slot_id in sup_slots
            obs_available = room_slot_id in obs_slots
            
            if sup_available and obs_available:
                domain.append(room_slot_index)

        student_domains.append(domain)

        # Step 2: Create one Boolean decision variable for every feasible
        # (student, room-slot) pair. In CP-SAT, a value of 1 means the student is
        # assigned to that exact room-slot.
        vars_for_student = []
        for room_slot_index in domain:
            var = model.NewBoolVar(f"x_s{student_index}_r{room_slot_index}")
            student_vars[(student_index, room_slot_index)] = var
            vars_for_student.append(var)
            room_slot_to_vars[room_slot_index].append(var)

            room_slot = all_room_slots[room_slot_index]
            professor_slot_to_vars[(student["supervisorId"], room_slot["slotId"])].append(var)
            professor_slot_to_vars[(student["observerId"], room_slot["slotId"])].append(var)
            day = slot_day_by_slot_id.get(room_slot["slotId"], room_slot.get("timeLabel", ""))
            professor_day_to_vars[(student["supervisorId"], day)].append(var)
            professor_day_to_vars[(student["observerId"], day)].append(var)

        # Hard constraint A: each student can be assigned to at most one room-slot.
        if vars_for_student:
            model.Add(sum(vars_for_student) <= 1)

    # Hard constraint B: each room-slot can host at most one student.
    for vars_for_room_slot in room_slot_to_vars.values():
        model.Add(sum(vars_for_room_slot) <= 1)

    # Hard constraint C: a professor cannot appear in two presentations in the
    # same logical slot, whether as supervisor or observer.
    for vars_for_prof_slot in professor_slot_to_vars.values():
        model.Add(sum(vars_for_prof_slot) <= 1)

    # The objective is hierarchical: first maximize how many students are placed,
    # then improve quality by minimizing weighted soft-preference violations.
    assignment_count = sum(student_vars.values())
    soft_penalty_terms = []
    soft_penalty_upper_bound = 0

    if prof_preferences:
        # Build optional soft-cost terms. These do not affect validity; they only
        # decide which valid schedule is more desirable.
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

            # day_used tells the solver whether a professor is used on a
            # particular day at least once. It is a useful bridge variable for
            # day-based preferences such as concentration and spread.
            for day in all_days:
                day_vars = professor_day_to_vars.get((professor_id, day), [])
                if not day_vars:
                    continue
                day_used = model.NewBoolVar(f"prof_day_used_{professor_id}_{abs(hash(day))}")
                model.AddMaxEquality(day_used, day_vars)
                day_used_vars.append(day_used)

            if pref_type == "CONCENTRATE":
                # CONCENTRATE penalizes using too many different days. If a
                # professor appears on N days, the extra-days penalty is N - 1.
                if day_used_vars:
                    extra_days = model.NewIntVar(0, len(day_used_vars), f"extra_days_{professor_id}")
                    model.Add(extra_days >= sum(day_used_vars) - 1)
                    soft_penalty_terms.append(extra_days * effective_weight)
                    soft_penalty_upper_bound += max(0, len(day_used_vars) - 1) * effective_weight
                continue

            if pref_type == "MAX_PER_DAY":
                # MAX_PER_DAY penalizes any assignments above the preferred daily
                # limit for a professor.
                limit = int(pref.get("target", 3) or 3)
                for day in all_days:
                    day_vars = professor_day_to_vars.get((professor_id, day), [])
                    if not day_vars:
                        continue
                    max_excess = max(0, len(day_vars) - limit)
                    if max_excess == 0:
                        continue
                    excess = model.NewIntVar(0, max_excess, f"daily_excess_{professor_id}_{abs(hash(day))}")
                    model.Add(excess >= sum(day_vars) - limit)
                    soft_penalty_terms.append(excess * effective_weight)
                    soft_penalty_upper_bound += max_excess * effective_weight
                continue

            # SPREAD encourages using enough distinct days. shortage becomes a
            # penalty when the total load is too concentrated into too few days.
            total_load_expr = sum(
                var
                for (student_index, room_slot_index), var in student_vars.items()
                if professor_id in (
                    students[student_index]["supervisorId"],
                    students[student_index]["observerId"],
                )
            )
            max_shortage = (professor_loads.get(professor_id, 0) + 1) // 2
            if max_shortage > 0:
                shortage = model.NewIntVar(0, max_shortage, f"spread_shortage_{professor_id}")
                model.Add(total_load_expr <= 2 * sum(day_used_vars) + 2 * shortage)
                soft_penalty_terms.append(shortage * effective_weight)
                soft_penalty_upper_bound += max_shortage * effective_weight

    phase_one_timeout_seconds = max(0.5, (timeout_ms / 1000) * 0.4)
    phase_two_timeout_seconds = max(0.5, (timeout_ms / 1000) - phase_one_timeout_seconds)

    # Phase 1: ignore soft quality and maximize the number of scheduled students.
    model.Maximize(assignment_count)
    phase_one_solver = cp_model.CpSolver()
    configure_solver(phase_one_solver, phase_one_timeout_seconds)

    phase_one_status = phase_one_solver.Solve(model)
    if phase_one_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(json.dumps({"error": "CP-SAT 找不到可行解"}))
        return

    best_assignment_count = sum(
        phase_one_solver.Value(var)
        for var in student_vars.values()
    )

    # Phase 2: freeze the best coverage and search only for a better soft-cost.
    # This avoids improving preferences at the expense of scheduling fewer students.
    final_solver = phase_one_solver
    if soft_penalty_terms:
        model.Add(assignment_count == best_assignment_count)
        model.Minimize(sum(soft_penalty_terms))

        phase_two_solver = cp_model.CpSolver()
        configure_solver(phase_two_solver, phase_two_timeout_seconds)

        phase_two_status = phase_two_solver.Solve(model)
        if phase_two_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            final_solver = phase_two_solver

    # Convert the chosen CP variables back into real assignment records.
    assignments, assigned_students = collect_assignments(final_solver, student_vars, students, all_room_slots)

    # Any student not present in assigned_students must be explained in the
    # unscheduled list so the frontend can show a complete result.
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

    # Keep the output contract stable for the UI: success flag, concrete
    # assignments, explicit unscheduled cases, and an optional soft-cost summary.
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
