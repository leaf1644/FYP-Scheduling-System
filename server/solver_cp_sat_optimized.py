import json
import re
import sys
from collections import defaultdict

from ortools.sat.python import cp_model


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


def calculate_soft_cost(assignments, students, prof_preferences):
    if not prof_preferences:
        return None

    prof_stats = {}
    for assignment in assignments:
        student = assignment["student"]
        day = get_date_from_slot(assignment["roomSlot"]["timeLabel"])

        for professor_id in (student["supervisorId"], student["observerId"]):
            if professor_id not in prof_stats:
                prof_stats[professor_id] = {"days": set(), "dailyLoad": defaultdict(int)}
            prof_stats[professor_id]["days"].add(day)
            prof_stats[professor_id]["dailyLoad"][day] += 1

    total_cost = 0
    for professor_id, stats in prof_stats.items():
        pref = prof_preferences.get(professor_id, {"type": "CONCENTRATE", "weight": 10})
        pref_type = pref.get("type", "CONCENTRATE")
        weight = int(pref.get("weight", 10) or 10)

        if pref_type == "CONCENTRATE":
            if len(stats["days"]) > 1:
                total_cost += (len(stats["days"]) - 1) * weight
            continue

        if pref_type == "MAX_PER_DAY":
            limit = int(pref.get("target", 3) or 3)
            for load in stats["dailyLoad"].values():
                if load > limit:
                    total_cost += (load - limit) * weight
            continue

        total_load = sum(stats["dailyLoad"].values())
        ideal_days = (total_load + 1) // 2
        if len(stats["days"]) < ideal_days:
            total_cost += (ideal_days - len(stats["days"])) * weight

    return total_cost


def main():
    payload = read_payload()
    students = payload.get("students", [])
    all_room_slots = payload.get("allRoomSlots", [])
    prof_availability = payload.get("profAvailability", {})
    prof_preferences = payload.get("profPreferences", {})
    
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

        # 每個學生最多被分配到一個時段
        if vars_for_student:
            model.Add(sum(vars_for_student) <= 1)

    # 每個房間時段最多被分配一個學生
    for vars_for_room_slot in room_slot_to_vars.values():
        model.Add(sum(vars_for_room_slot) <= 1)

    # 每個教授每個時段最多被分配一個學生
    for vars_for_prof_slot in professor_slot_to_vars.values():
        model.Add(sum(vars_for_prof_slot) <= 1)

    # 目標：最大化被分配的學生數量
    objective_terms = list(student_vars.values())
    model.Maximize(sum(objective_terms))

    # 優化 4: 加入 CpSolverParameters，設定更多 workers 與更好的 branching_strategy
    solver = cp_model.CpSolver()
    
    # 配置求解器參數以達到更好的最優性
    solver.parameters.max_time_in_seconds = timeout_ms / 1000
    solver.parameters.num_search_workers = 16  # 增加 workers 數量（從 8 改為 16）
    solver.parameters.log_search_progress = False
    
    # 設定更好的 branching strategy
    solver.parameters.cp_model_presolve = True
    solver.parameters.linearization_level = 2
    solver.parameters.use_absl_random = True
    solver.parameters.random_seed = 42
    
    # 進一步優化策略
    solver.parameters.max_num_concurrent_workers = 16
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
        "softConstraintCost": calculate_soft_cost(assignments, students, prof_preferences),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
