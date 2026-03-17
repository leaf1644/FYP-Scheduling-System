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


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def get_date_from_slot(label: str) -> str:
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


def main():
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

    # 決策變數：x[i][j] = 1 如果學生 i 分配到房間時段 j
    x = {}
    student_domains = []
    professor_day_to_vars = defaultdict(list)
    slot_day_by_slot_id = {
        room_slot["slotId"]: get_date_from_slot(room_slot.get("timeLabel", ""))
        for room_slot in all_room_slots
    }
    all_days = sorted(set(slot_day_by_slot_id.values()))

    for student_index, student in enumerate(students):
        sup_slots = set(prof_availability.get(student["supervisorId"], []))
        obs_slots = set(prof_availability.get(student["observerId"], []))
        domain = []

        for room_slot_index, room_slot in enumerate(all_room_slots):
            room_slot_id = room_slot["slotId"]
            if room_slot_id in sup_slots and room_slot_id in obs_slots:
                domain.append(room_slot_index)
                # 創建二元變數
                var_name = f"x_{student_index}_{room_slot_index}"
                x[(student_index, room_slot_index)] = LpVariable(var_name, cat="Binary")
                day = slot_day_by_slot_id.get(room_slot_id, room_slot.get("timeLabel", ""))
                professor_day_to_vars[(student["supervisorId"], day)].append(x[(student_index, room_slot_index)])
                professor_day_to_vars[(student["observerId"], day)].append(x[(student_index, room_slot_index)])

        student_domains.append(domain)

    assignment_count = lpSum([x[key] for key in x.keys()])

    # 硬約束 1: 每個學生最多被分配到一個時段
    for student_index in range(len(students)):
        vars_for_student = [x[(student_index, room_slot_index)] 
                           for room_slot_index in student_domains[student_index]]
        if vars_for_student:
            prob += lpSum(vars_for_student) <= 1, f"max_one_slot_per_student_{student_index}"

    # 硬約束 2: 每個房間時段最多被分配一個學生
    room_slot_to_vars = defaultdict(list)
    for (student_index, room_slot_index), var in x.items():
        room_slot_to_vars[room_slot_index].append(var)

    for room_slot_index, vars_for_room_slot in room_slot_to_vars.items():
        prob += lpSum(vars_for_room_slot) <= 1, f"max_one_student_per_slot_{room_slot_index}"

    # 硬約束 3: 教授可用性與時段衝突
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

    soft_penalty_terms = []
    soft_penalty_upper_bound = 0
    if prof_preferences:
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
                if day_used_vars:
                    extra_days = LpVariable(f"extra_days_{professor_id}", lowBound=0, upBound=len(day_used_vars), cat="Integer")
                    prob += extra_days >= lpSum(day_used_vars) - 1, f"extra_days_lb_{professor_id}"
                    soft_penalty_terms.append(extra_days * effective_weight)
                    soft_penalty_upper_bound += max(0, len(day_used_vars) - 1) * effective_weight
                continue

            if pref_type == "MAX_PER_DAY":
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

    if soft_penalty_terms:
        assignment_scale = soft_penalty_upper_bound + 1
        prob += assignment_count * assignment_scale - lpSum(soft_penalty_terms), "maximize_assignments_then_weighted_preferences"
    else:
        prob += assignment_count, "maximize_assignments"

    # 使用 CBC 求解器，設定 timeout
    solver_options = [
        f"-sec {timeout_seconds:.1f}",  # 超時秒數
        "-threads 8",  # 增加執行緒
    ]
    solver = PULP_CBC_CMD(
        timeLimit=timeout_seconds,
        threads=8,
        msg=0,
        options=solver_options
    )

    status = prob.solve(solver)

    # 精準求解狀態檢查
    # - Optimal：找到最優解
    # - Not Solved：超時但可能有可行解（CBC 特有行為）
    # - Infeasible：確實無可行解
    if LpStatus[status] == "Infeasible":
        print(json.dumps({"error": "MILP 模型無可行解"}))
        return
    elif LpStatus[status] == "Unbounded":
        print(json.dumps({"error": "MILP 模型無界"}))
        return
    
    # 檢查是否有可行解（包括 Optimal 和超時但有可行解的情況）
    has_feasible_solution = prob.status == 1 or any(
        var.varValue is not None for var in x.values()
    )
    
    if not has_feasible_solution:
        print(json.dumps({"error": f"MILP 求解失敗：{LpStatus[status]}"}))
        return

    # 提取分配結果
    assignments = []
    assigned_students = set()

    for (student_index, room_slot_index), var in x.items():
        if var.varValue and var.varValue > 0.5:  # 檢查二元變數值是否為 1
            assigned_students.add(student_index)
            assignments.append({
                "student": students[student_index],
                "roomSlot": all_room_slots[room_slot_index],
            })

    # 生成未排程學生清單
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

    # 輸出結果（與原有 solver 格式相容）
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
