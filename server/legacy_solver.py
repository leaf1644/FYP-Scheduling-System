import json
import re
import sys
import time
import random
from collections import defaultdict
from copy import deepcopy
from functools import cmp_to_key

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
        if not assignment:
            continue
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


def get_static_domain(student, all_room_slots, prof_availability):
    sup_slots = set(prof_availability.get(student["supervisorId"], []))
    obs_slots = set(prof_availability.get(student["observerId"], []))
    return [room for room in all_room_slots if room["slotId"] in sup_slots and room["slotId"] in obs_slots]


def has_timed_out(start_time, timeout_ms):
    return time.time() - start_time > timeout_ms / 1000.0


def clone_assignments(assignments):
    return deepcopy(assignments)


def get_blocking_student_indices(ctx, assignments, student_index, candidate):
    blockers = set()
    student = ctx["students"][student_index]["student"]
    for idx, assignment in enumerate(assignments):
        if assignment is None or idx == student_index:
            continue
        other = ctx["students"][assignment["studentIndex"]]["student"]
        if (assignment["roomSlot"]["roomId"] == candidate["roomId"] and
                assignment["roomSlot"]["slotId"] == candidate["slotId"]):
            blockers.add(idx)
        if assignment["roomSlot"]["slotId"] != candidate["slotId"]:
            continue
        if (student["supervisorId"] == other["supervisorId"] or
            student["supervisorId"] == other["observerId"] or
            student["observerId"] == other["supervisorId"] or
            student["observerId"] == other["observerId"]):
            blockers.add(idx)
    return list(blockers)


def is_valid_move(ctx, student_index, candidate):
    return len(get_blocking_student_indices(ctx, ctx["assignments"], student_index, candidate)) == 0


def compare_candidate_slots(ctx, assignments, student_index, left, right, randomize=False):
    left_blockers = len(get_blocking_student_indices(ctx, assignments, student_index, left))
    right_blockers = len(get_blocking_student_indices(ctx, assignments, student_index, right))
    if left_blockers != right_blockers:
        return left_blockers - right_blockers

    left_demand = ctx["slot_demand"].get(left["slotId"], 0)
    right_demand = ctx["slot_demand"].get(right["slotId"], 0)
    if left_demand != right_demand:
        return left_demand - right_demand

    if randomize:
        return random.random() - 0.5

    left_time = left.get("timeLabel", "") or ""
    right_time = right.get("timeLabel", "") or ""
    if left_time != right_time:
        return -1 if left_time < right_time else 1

    left_room = left.get("roomName", "") or ""
    right_room = right.get("roomName", "") or ""
    if left_room != right_room:
        return -1 if left_room < right_room else 1

    return 0


def forward_check(ctx, current_index, candidate):
    current_student = ctx["students"][current_index]["student"]
    for neighbor_idx in ctx["conflict_graph"][current_index]:
        if ctx["assignments"][neighbor_idx] is not None:
            continue
        neighbor = ctx["students"][neighbor_idx]
        has_viable = any(
            (opt["roomId"] != candidate["roomId"] or opt["slotId"] != candidate["slotId"]) and
            not (opt["slotId"] == candidate["slotId"] and (
                neighbor["student"]["supervisorId"] in (current_student["supervisorId"], current_student["observerId"]) or
                neighbor["student"]["observerId"] in (current_student["supervisorId"], current_student["observerId"])
            )) and
            len(get_blocking_student_indices(ctx, ctx["assignments"], neighbor_idx, opt)) == 0
            for opt in neighbor["valid_room_slots"]
        )
        if not has_viable:
            return False
    return True


def solve_strict(ctx, student_order, depth):
    if depth % 40 == 0 and has_timed_out(ctx["start_time"], ctx["timeout_ms"]):
        return False
    if depth == len(student_order):
        return True

    current_idx = student_order[depth]
    domain = ctx["students"][current_idx]
    ordered_slots = sorted(
        domain["valid_room_slots"],
        key=cmp_to_key(lambda left, right: compare_candidate_slots(ctx, ctx["assignments"], current_idx, left, right))
    )

    for slot in ordered_slots:
        if not is_valid_move(ctx, current_idx, slot):
            continue
        if not forward_check(ctx, current_idx, slot):
            continue

        ctx["assignments"][current_idx] = {"studentIndex": current_idx, "roomSlot": slot}
        if solve_strict(ctx, student_order, depth + 1):
            return True
        ctx["assignments"][current_idx] = None
    return False


def solve_greedy_pass(ctx, student_order, randomize=False):
    ctx["assignments"] = [None] * len(ctx["students"])
    unscheduled = []
    for idx in student_order:
        domain = ctx["students"][idx]
        sorted_slots = sorted(
            domain["valid_room_slots"],
            key=cmp_to_key(
                lambda left, right: compare_candidate_slots(ctx, ctx["assignments"], idx, left, right, randomize)
            ),
        )
        chosen = next((s for s in sorted_slots if is_valid_move(ctx, idx, s)), None)
        if chosen:
            ctx["assignments"][idx] = {"studentIndex": idx, "roomSlot": chosen}
        else:
            unscheduled.append(idx)
    return unscheduled


def perturb_student_order(ctx, base_order):
    shuffled = base_order[:]
    for i in range(len(shuffled)-1, 0, -1):
        if random.random() > 0.35:
            continue
        j = random.randint(0, i)
        shuffled[i], shuffled[j] = shuffled[j], shuffled[i]

    shuffled.sort(key=lambda x: (
        len(ctx["students"][x]["valid_room_slots"]),
        -len(ctx["conflict_graph"][x]),
        random.random()
    ))
    return shuffled


def solve_multi_start(ctx, base_order):
    best_assignments = clone_assignments(ctx["assignments"])
    best_unscheduled = solve_greedy_pass(ctx, base_order, False)
    best_unscheduled = repair_schedule(ctx, best_unscheduled)  # 後續定義 repair
    best_assignments = clone_assignments(ctx["assignments"])

    iteration = 0
    max_iter = 200
    while not has_timed_out(ctx["start_time"], ctx["timeout_ms"]) and iteration < max_iter and best_unscheduled:
        trial_order = perturb_student_order(ctx, base_order)
        trial_unscheduled = solve_greedy_pass(ctx, trial_order, True)
        if trial_unscheduled:
            trial_unscheduled = repair_schedule(ctx, trial_unscheduled)
        if len(trial_unscheduled) < len(best_unscheduled):
            best_assignments = clone_assignments(ctx["assignments"])
            best_unscheduled = trial_unscheduled[:]
        iteration += 1
    ctx["assignments"] = best_assignments
    return best_unscheduled


def optimize_schedule(ctx):
    current_cost = calculate_soft_cost(
        [{"student": ctx["students"][i]["student"], "roomSlot": a["roomSlot"]} 
         for i, a in enumerate(ctx["assignments"]) if a],
        ctx["students"], ctx["prof_preferences"]
    ) or 0
    for _ in range(3000):
        if has_timed_out(ctx["start_time"], ctx["timeout_ms"]):
            return
        idx = random.randint(0, len(ctx["assignments"])-1)
        if ctx["assignments"][idx] is None:
            continue
        domain = ctx["students"][idx]["valid_room_slots"]
        if len(domain) <= 1:
            continue
        new_slot = random.choice(domain)
        if new_slot["id"] == ctx["assignments"][idx]["roomSlot"]["id"]:
            continue
        if not is_valid_move(ctx, idx, new_slot):
            continue
        old = ctx["assignments"][idx]
        ctx["assignments"][idx] = {"studentIndex": idx, "roomSlot": new_slot}
        new_cost = calculate_soft_cost(
            [{"student": ctx["students"][i]["student"], "roomSlot": a["roomSlot"]} 
             for i, a in enumerate(ctx["assignments"]) if a],
            ctx["students"], ctx["prof_preferences"]
        ) or 0
        if new_cost <= current_cost:
            current_cost = new_cost
        else:
            ctx["assignments"][idx] = old


def summarize_unscheduled(ctx, student_index):
    domain = ctx["students"][student_index]
    if not domain["valid_room_slots"]:
        return {"reason": "NO_COMMON_TIME", "details": "指導教授與口試教授沒有任何共同可用時段。"}
    return {"reason": "PROF_BUSY", "details": "可用時段已被其他安排占用，或教授在同時段有衝堂。"}


def try_repair_placement(ctx, student_index, depth_remaining, visiting_students, reserved_slot_ids):
    if has_timed_out(ctx["start_time"], ctx["timeout_ms"]) or depth_remaining < 0 or student_index in visiting_students:
        return False

    visiting_students.add(student_index)
    current_assignment = ctx["assignments"][student_index]
    candidates = [
        slot for slot in ctx["students"][student_index]["valid_room_slots"]
        if slot["id"] not in reserved_slot_ids
    ]
    candidates = sorted(
        candidates,
        key=cmp_to_key(lambda left, right: compare_candidate_slots(ctx, ctx["assignments"], student_index, left, right)),
    )

    for candidate in candidates:
        if current_assignment and current_assignment["roomSlot"]["id"] == candidate["id"]:
            visiting_students.remove(student_index)
            return True

        blockers = get_blocking_student_indices(ctx, ctx["assignments"], student_index, candidate)
        if blockers and depth_remaining == 0:
            continue

        snapshot = clone_assignments(ctx["assignments"])
        ctx["assignments"][student_index] = None
        for blocker_index in blockers:
            ctx["assignments"][blocker_index] = None

        next_reserved = set(reserved_slot_ids)
        next_reserved.add(candidate["id"])
        ordered_blockers = sorted(
            blockers,
            key=lambda idx: len(ctx["students"][idx]["valid_room_slots"]),
        )

        repaired = True
        for blocker_index in ordered_blockers:
            if not try_repair_placement(ctx, blocker_index, depth_remaining - 1, visiting_students, set(next_reserved)):
                repaired = False
                break

        if repaired and is_valid_move(ctx, student_index, candidate):
            ctx["assignments"][student_index] = {"studentIndex": student_index, "roomSlot": candidate}
            visiting_students.remove(student_index)
            return True

        ctx["assignments"] = snapshot

    visiting_students.remove(student_index)
    return False


def repair_schedule(ctx, unscheduled_indices):
    remaining = unscheduled_indices[:]
    made_progress = True
    while made_progress and remaining and not has_timed_out(ctx["start_time"], ctx["timeout_ms"]):
        made_progress = False
        for idx in sorted(remaining, key=lambda x: (len(ctx["students"][x]["valid_room_slots"]), -len(ctx["conflict_graph"][x]))):
            domain_size = len(ctx["students"][idx]["valid_room_slots"])
            if domain_size == 0:
                continue
            depth_limit = 4 if domain_size <= 4 else (3 if domain_size <= 12 else 2)
            if try_repair(ctx, idx, depth_limit):
                remaining.remove(idx)
                made_progress = True
    return remaining


def try_repair(ctx, student_index, depth_limit=None):
    if depth_limit is None:
        domain_size = len(ctx["students"][student_index]["valid_room_slots"])
        depth_limit = 4 if domain_size <= 4 else (3 if domain_size <= 12 else 2)
    return try_repair_placement(ctx, student_index, depth_limit, set(), set())


def main():
    payload = read_payload()
    students = payload.get("students", [])
    all_room_slots = payload.get("allRoomSlots", [])
    prof_availability = payload.get("profAvailability", {})
    prof_preferences = payload.get("profPreferences", {})
    timeout_raw = payload.get("timeoutMs", 1500)
    timeout_ms = max(500, int(timeout_raw if timeout_raw is not None else 1500))

    # 建立 domain 與衝突圖
    student_domains = [
        {"studentIndex": i, "student": s, "valid_room_slots": get_static_domain(s, all_room_slots, prof_availability)}
        for i, s in enumerate(students)
    ]

    conflict_graph = [[] for _ in students]
    for i in range(len(students)):
        for j in range(i + 1, len(students)):
            left = students[i]
            right = students[j]
            if (left["supervisorId"] == right["supervisorId"] or
                left["supervisorId"] == right["observerId"] or
                left["observerId"] == right["supervisorId"] or
                left["observerId"] == right["observerId"]):
                conflict_graph[i].append(j)
                conflict_graph[j].append(i)

    student_order = sorted(
        range(len(students)),
        key=lambda x: (len(student_domains[x]["valid_room_slots"]), -len(conflict_graph[x]))
    )

    ctx = {
        "students": student_domains,
        "assignments": [None] * len(students),
        "conflict_graph": conflict_graph,
        "slot_demand": defaultdict(int),
        "start_time": time.time(),
        "prof_preferences": prof_preferences,
        "timeout_ms": timeout_ms,
    }
    for domain in student_domains:
        for slot in domain["valid_room_slots"]:
            ctx["slot_demand"][slot["slotId"]] += 1

    # 先嘗試嚴格回溯
    solved = solve_strict(ctx, student_order, 0)

    if not solved:
        # 啟發式後備
        unscheduled = solve_greedy_pass(ctx, student_order)
        unscheduled = repair_schedule(ctx, unscheduled)
        unscheduled = solve_multi_start(ctx, student_order)

    # 優化軟約束
    if prof_preferences:
        optimize_schedule(ctx)

    # 產生輸出
    assignments = []
    for a in ctx["assignments"]:
        if a:
            assignments.append({
                "student": student_domains[a["studentIndex"]]["student"],
                "roomSlot": a["roomSlot"]
            })

    unscheduled_list = []
    for i in range(len(students)):
        if ctx["assignments"][i] is not None:
            continue
        summary = summarize_unscheduled(ctx, i)
        unscheduled_list.append({
            "student": student_domains[i]["student"],
            "reason": summary["reason"],
            "details": summary["details"],
        })

    result = {
        "success": len(unscheduled_list) == 0,
        "assignments": assignments,
        "unscheduled": unscheduled_list,
        "softConstraintCost": calculate_soft_cost(assignments, students, prof_preferences)
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)