import json
import re
import sys
import time
import random
from collections import defaultdict
from copy import deepcopy
from functools import cmp_to_key
from faculty_priority import build_professor_priority_context, calculate_weighted_soft_cost

def read_payload():
    """Read the normalized scheduling payload from stdin.

    All solver backends receive the same frontend payload shape. This helper only
    deserializes that JSON and returns an empty object when stdin is empty.
    """
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def get_date_from_slot(label: str) -> str:
    """Extract the day label from a slot string for preference evaluation.

    The legacy solver optimizes soft preferences at the day level. This helper
    removes the trailing time range and keeps only the date or logical day part.
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


def calculate_soft_cost(assignments, students, prof_preferences, professor_priority_context, prioritize_faculty=False):
    """Compute the current soft-preference cost of heuristic assignments.

    The legacy solver uses this score during local improvement. It converts the
    current assignment set into simplified day-based records and then calls the
    shared faculty-priority helper.
    """
    if not prof_preferences:
        return None

    assignment_records = []
    for assignment in assignments:
        if not assignment:
            continue
        assignment_records.append({
            "student": assignment["student"],
            "day": get_date_from_slot(assignment["roomSlot"]["timeLabel"]),
        })

    return calculate_weighted_soft_cost(
        assignment_records,
        prof_preferences,
        professor_priority_context,
        prioritize_faculty=prioritize_faculty,
    )


def get_static_domain(student, all_room_slots, prof_availability):
    """Build the feasible room-slot domain for one student.

    A room-slot is kept only when both the supervisor and observer are available
    in that logical slot. This domain becomes the search space used by all later
    heuristic stages.
    """
    sup_slots = set(prof_availability.get(student["supervisorId"], []))
    obs_slots = set(prof_availability.get(student["observerId"], []))
    return [room for room in all_room_slots if room["slotId"] in sup_slots and room["slotId"] in obs_slots]


def has_timed_out(start_time, timeout_ms):
    """Return whether the current heuristic search exceeded the time budget."""
    return time.time() - start_time > timeout_ms / 1000.0


def clone_assignments(assignments):
    """Deep-copy assignments so heuristic branches can backtrack safely."""
    return deepcopy(assignments)


def get_blocking_student_indices(ctx, assignments, student_index, candidate):
    """Find which existing assignments would conflict with a candidate slot.

    Conflicts come from either reusing the same room-slot or putting shared
    professors into two presentations at the same logical slot.
    """
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
    """Check whether assigning a student to a candidate slot is conflict-free."""
    return len(get_blocking_student_indices(ctx, ctx["assignments"], student_index, candidate)) == 0


def compare_candidate_slots(ctx, assignments, student_index, left, right, randomize=False):
    """Rank candidate slots for heuristic selection.

    The ordering prefers slots with fewer blockers, then lower demand pressure.
    If randomization is enabled, a random tie-break is injected so multi-start
    search can explore different schedules.
    """
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
    """Prune choices that would leave neighboring students with no future slot.

    This is a classic forward-checking heuristic used during backtracking. It is
    cheaper than full lookahead but still prevents many dead-end branches.
    """
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
    """Try to find a complete schedule via recursive backtracking.

    Students are processed in a heuristic order. For each student, the solver
    tries feasible slots, checks immediate conflicts, applies forward checking,
    and backtracks if the partial assignment cannot be completed.
    """
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
    """Build a schedule greedily using the slot ranking heuristic.

    This is the first fallback when strict backtracking fails. It places each
    student into the first currently valid slot in the ranked list and records
    any students that still cannot be assigned.
    """
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
    """Randomly perturb the student order for multi-start search.

    The legacy solver explores multiple greedy runs with slightly different input
    orders. This helps it escape deterministic local patterns and sometimes find
    better coverage.
    """
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
    """Run repeated greedy-repair attempts and keep the best result found.

    Multi-start search starts from the current best schedule, then tries many
    perturbed student orders with randomized tie-breaking. Whenever a trial yields
    fewer unscheduled students, it replaces the previous best schedule.
    """
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
    """Locally improve soft preference quality after coverage is decided.

    This stage performs random local moves. A new assignment is accepted only if
    it improves or preserves the current soft cost, so hard-constraint validity is
    preserved while preference quality is refined.
    """
    current_cost = calculate_soft_cost(
        [{"student": ctx["students"][i]["student"], "roomSlot": a["roomSlot"]} 
         for i, a in enumerate(ctx["assignments"]) if a],
        ctx["students"], ctx["prof_preferences"]
        , ctx["professor_priority_context"], True
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
            , ctx["professor_priority_context"], True
        ) or 0
        if new_cost <= current_cost:
            current_cost = new_cost
        else:
            ctx["assignments"][idx] = old


def summarize_unscheduled(ctx, student_index):
    """Generate a UI-friendly explanation for an unscheduled student."""
    domain = ctx["students"][student_index]
    if not domain["valid_room_slots"]:
        return {"reason": "NO_COMMON_TIME", "details": "指導教授與口試教授沒有任何共同可用時段。"}
    return {"reason": "PROF_BUSY", "details": "可用時段已被其他安排占用，或教授在同時段有衝堂。"}


def try_repair_placement(ctx, student_index, depth_remaining, visiting_students, reserved_slot_ids):
    """Recursively try to place one student by displacing blocking assignments.

    This is the core repair routine. It temporarily removes blockers, tries to
    re-place them elsewhere, and commits the move only if the whole repair chain
    succeeds within the allowed depth.
    """
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
    """Repeatedly attempt local repairs for still-unscheduled students."""
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
    """Choose a depth limit and call the recursive repair routine."""
    if depth_limit is None:
        domain_size = len(ctx["students"][student_index]["valid_room_slots"])
        depth_limit = 4 if domain_size <= 4 else (3 if domain_size <= 12 else 2)
    return try_repair_placement(ctx, student_index, depth_limit, set(), set())


def main():
    """Execute the full heuristic scheduling pipeline from top to bottom.

    High-level flow:
    1. Read normalized payload.
    2. Build domains and the student conflict graph.
    3. Try strict backtracking first.
    4. If needed, fall back to greedy construction, repair, and multi-start.
    5. Optionally refine soft preference quality.
    6. Output assignments and unscheduled explanations.
    """
    payload = read_payload()
    students = payload.get("students", [])
    all_room_slots = payload.get("allRoomSlots", [])
    prof_availability = payload.get("profAvailability", {})
    prof_preferences = payload.get("profPreferences", {})
    professor_priority_context = build_professor_priority_context(students)
    timeout_raw = payload.get("timeoutMs", 1500)
    timeout_ms = max(500, int(timeout_raw if timeout_raw is not None else 1500))

    # Step 1: Build the feasible domain for every student.
    student_domains = [
        {"studentIndex": i, "student": s, "valid_room_slots": get_static_domain(s, all_room_slots, prof_availability)}
        for i, s in enumerate(students)
    ]

    # Step 2: Build a conflict graph. Two students conflict if they share a
    # supervisor or observer and therefore cannot be scheduled in the same slot.
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

    # The shared context object carries the current assignment state, heuristic
    # metadata, and runtime budget across all heuristic stages.
    ctx = {
        "students": student_domains,
        "assignments": [None] * len(students),
        "conflict_graph": conflict_graph,
        "slot_demand": defaultdict(int),
        "start_time": time.time(),
        "prof_preferences": prof_preferences,
        "professor_priority_context": professor_priority_context,
        "timeout_ms": timeout_ms,
    }
    for domain in student_domains:
        for slot in domain["valid_room_slots"]:
            ctx["slot_demand"][slot["slotId"]] += 1

    # Step 3: Try strict backtracking first. This gives the solver one chance to
    # find a complete valid solution without heuristic compromise.
    solved = solve_strict(ctx, student_order, 0)

    if not solved:
        # Step 4: Fall back to a layered heuristic pipeline.
        unscheduled = solve_greedy_pass(ctx, student_order)
        unscheduled = repair_schedule(ctx, unscheduled)
        unscheduled = solve_multi_start(ctx, student_order)

    # Step 5: If preferences exist, refine the chosen schedule locally.
    if prof_preferences:
        optimize_schedule(ctx)

    # Step 6: Convert the internal assignment state into the common output format.
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

    # The output format mirrors the other solvers so the frontend does not need
    # solver-specific rendering logic.
    result = {
        "success": len(unscheduled_list) == 0,
        "assignments": assignments,
        "unscheduled": unscheduled_list,
        "softConstraintCost": calculate_soft_cost(assignments, students, prof_preferences, professor_priority_context)
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)