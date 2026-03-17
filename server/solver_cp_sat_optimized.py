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

    for student_index, student in enumerate(students):
        # 取得指導教授與口試教授的可用時段（前端已處理 "if necessary" → true）
        sup_slots = set(prof_availability.get(student["supervisorId"], []))
        obs_slots = set(prof_availability.get(student["observerId"], []))
        domain = []

        # 優化 3: 改善時間區塊映射邏輯
        # 確保 room 細時段正確對應教授粗區塊
        for room_slot_index, room_slot in enumerate(all_room_slots):
            room_slot_id = room_slot["slotId"]
            
            # 檢查該房間時段是否被兩個教授都標記為可用
            sup_available = room_slot_id in sup_slots
            obs_available = room_slot_id in obs_slots
            
            if sup_available and obs_available:
                domain.append(room_slot_index)

        student_domains.append(domain)

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

        # 每個學生最多被分配到一個時段
        if vars_for_student:
            model.Add(sum(vars_for_student) <= 1)

    # 每個房間時段最多被分配一個學生
    for vars_for_room_slot in room_slot_to_vars.values():
        model.Add(sum(vars_for_room_slot) <= 1)

    # 每個教授每個時段最多被分配一個學生
    for vars_for_prof_slot in professor_slot_to_vars.values():
        model.Add(sum(vars_for_prof_slot) <= 1)

    # 目標：先最大化被分配的學生數量，再依教授職級與網站順序最小化偏好違反
    assignment_count = sum(student_vars.values())
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
                day_used = model.NewBoolVar(f"prof_day_used_{professor_id}_{abs(hash(day))}")
                model.AddMaxEquality(day_used, day_vars)
                day_used_vars.append(day_used)

            if pref_type == "CONCENTRATE":
                if day_used_vars:
                    extra_days = model.NewIntVar(0, len(day_used_vars), f"extra_days_{professor_id}")
                    model.Add(extra_days >= sum(day_used_vars) - 1)
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
                    excess = model.NewIntVar(0, max_excess, f"daily_excess_{professor_id}_{abs(hash(day))}")
                    model.Add(excess >= sum(day_vars) - limit)
                    soft_penalty_terms.append(excess * effective_weight)
                    soft_penalty_upper_bound += max_excess * effective_weight
                continue

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

    if soft_penalty_terms:
        assignment_scale = soft_penalty_upper_bound + 1
        model.Maximize(assignment_count * assignment_scale - sum(soft_penalty_terms))
    else:
        model.Maximize(assignment_count)

    # 優化 4: 加入 CpSolverParameters，設定更多 workers 與更好的 branching_strategy
    solver = cp_model.CpSolver()
    
    # 配置求解器參數以達到更好的最優性
    solver.parameters.max_time_in_seconds = timeout_ms / 1000
    solver.parameters.num_search_workers = 16  # 增加 workers 數量（從 8 改為 16）
    solver.parameters.log_search_progress = False
    
    # 設定更好的 branching strategy
    solver.parameters.cp_model_presolve = True
    solver.parameters.linearization_level = 2
    solver.parameters.search_branching = cp_model.PORTFOLIO_SEARCH
    solver.parameters.use_absl_random = True
    solver.parameters.random_seed = 42
    
    # 進一步優化策略
    solver.parameters.interleave_search = True

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(json.dumps({"error": "CP-SAT 找不到可行解"}))
        return

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

    # 保留所有輸出格式與軟約束計算
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
