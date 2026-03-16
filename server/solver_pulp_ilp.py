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

        student_domains.append(domain)

    # 目標函數：最大化被分配的學生數量
    prob += lpSum([x[key] for key in x.keys()]), "maximize_assignments"

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
        "softConstraintCost": calculate_soft_cost(assignments, students, prof_preferences),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
