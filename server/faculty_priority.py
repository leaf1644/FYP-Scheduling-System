import re
from collections import defaultdict


HKBU_FACULTY_PRIORITY_LEFT_TO_RIGHT = [
    'Prof. XU, Jianliang',
    'Prof. CHOI, Byron Koon Kau',
    'Prof. CHEN, Li',
    'Prof. WONG, Martin Ding Fat',
    'Prof. LIU, Jiming',
    'Prof. CHEUNG, William Kwok Wai',
    'Prof. CHEUNG, Yiu Ming',
    'Prof. YUEN, Pong Chi',
    'Prof. NG, Michael Kwok Po',
    'Prof. LEUNG, Yiu Wing',
    "Prof. D'INVERNO, Mark",
    'Prof. KENDERDINE, Sarah Irene Brutton',
    'Prof. CHEN, Jie',
    'Prof. DAI, Henry Hong Ning',
    'Prof. HAN, Bo',
    'Prof. HUANG, Xin',
    'Prof. ZHANG, Eric Lu',
    'Prof. CHEN, Yifan',
    'Prof. GUO, Xiaoqing',
    'Prof. HUANG, Longkai',
    'Prof. LIU, Jinwei',
    'Prof. LIU, Yang',
    'Prof. MA, Jing',
    'Prof. WAN, Renjie',
    'Prof. WANG, Juncheng',
    'Prof. YANG, Renchi',
    'Prof. ZHOU, Amelie Chi',
    'Prof. ZHOU, Kaiyang',
    'Dr. PIAO, Chengzhi',
    'Dr. YIN, Kejing',
    'Dr. CHOY, Martin Man Ting',
    'Dr. LAI, Jean Hok Yin',
    'Dr. LI, Kristen Yuanxi',
    'Dr. CHAN, Jacky Chun Pong',
    'Dr. MA, Shichao',
    'Dr. SHEK, Sarah Pui Wah',
    'Dr. WANG, Kevin King Hang',
    'Dr. XIAN, Poline Yin',
    'Dr. YU, Wilson Shih Bun',
    'Dr. ZHANG, Ce',
]

HKBU_FACULTY_POSITION_BY_NAME = {
    'Prof. XU, Jianliang': 'Head & Chair Professor',
    'Prof. CHOI, Byron Koon Kau': 'Associate Head (Teaching and Learning) and Professor',
    'Prof. CHEN, Li': 'Associate Head (Research) and Professor',
    'Prof. WONG, Martin Ding Fat': 'Provost and Chair Professor',
    'Prof. LIU, Jiming': 'Associate Provost and Chair Professor',
    'Prof. CHEUNG, William Kwok Wai': 'Associate Vice-President (Transdisciplinary Education) and Professor',
    'Prof. CHEUNG, Yiu Ming': 'Chair Professor',
    'Prof. YUEN, Pong Chi': 'Chair Professor',
    'Prof. NG, Michael Kwok Po': 'Chair Professor (Affiliate)',
    'Prof. LEUNG, Yiu Wing': 'Professor',
    "Prof. D'INVERNO, Mark": 'Professor (Affiliate)',
    'Prof. KENDERDINE, Sarah Irene Brutton': 'Visiting Professor',
    'Prof. CHEN, Jie': 'Associate Professor',
    'Prof. DAI, Henry Hong Ning': 'Associate Professor',
    'Prof. HAN, Bo': 'Associate Professor',
    'Prof. HUANG, Xin': 'Associate Professor',
    'Prof. ZHANG, Eric Lu': 'Associate Professor',
    'Prof. CHEN, Yifan': 'Assistant Professor',
    'Prof. GUO, Xiaoqing': 'Assistant Professor',
    'Prof. HUANG, Longkai': 'Assistant Professor',
    'Prof. LIU, Jinwei': 'Assistant Professor',
    'Prof. LIU, Yang': 'Assistant Professor',
    'Prof. MA, Jing': 'Assistant Professor',
    'Prof. WAN, Renjie': 'Assistant Professor',
    'Prof. WANG, Juncheng': 'Assistant Professor',
    'Prof. YANG, Renchi': 'Assistant Professor',
    'Prof. ZHOU, Amelie Chi': 'Assistant Professor',
    'Prof. ZHOU, Kaiyang': 'Assistant Professor',
    'Dr. PIAO, Chengzhi': 'Research Assistant Professor',
    'Dr. YIN, Kejing': 'Research Assistant Professor',
    'Dr. CHOY, Martin Man Ting': 'Senior Lecturer',
    'Dr. LAI, Jean Hok Yin': 'Senior Lecturer',
    'Dr. LI, Kristen Yuanxi': 'Senior Lecturer',
    'Dr. CHAN, Jacky Chun Pong': 'Lecturer',
    'Dr. MA, Shichao': 'Lecturer',
    'Dr. SHEK, Sarah Pui Wah': 'Lecturer',
    'Dr. WANG, Kevin King Hang': 'Lecturer',
    'Dr. XIAN, Poline Yin': 'Lecturer',
    'Dr. YU, Wilson Shih Bun': 'Lecturer',
    'Dr. ZHANG, Ce': 'Lecturer',
}

POSITION_PRIORITY_BUCKETS = [
    (re.compile(r'head\s*&\s*chair professor', re.IGNORECASE), 0),
    (re.compile(r'provost\s+and\s+chair professor', re.IGNORECASE), 1),
    (re.compile(r'associate provost\s+and\s+chair professor', re.IGNORECASE), 2),
    (re.compile(r'associate head.*professor', re.IGNORECASE), 3),
    (re.compile(r'associate vice-president.*professor', re.IGNORECASE), 4),
    (re.compile(r'chair professor', re.IGNORECASE), 5),
    (re.compile(r'associate professor', re.IGNORECASE), 7),
    (re.compile(r'research assistant professor', re.IGNORECASE), 8),
    (re.compile(r'assistant professor', re.IGNORECASE), 8),
    (re.compile(r'senior lecturer', re.IGNORECASE), 10),
    (re.compile(r'lecturer', re.IGNORECASE), 11),
    (re.compile(r'visiting professor', re.IGNORECASE), 12),
    (re.compile(r'professor', re.IGNORECASE), 6),
]

BASE_WEIGHT_SCALE = 10000
MAX_PRIORITY_BONUS = 5000


def normalize_faculty_name(value):
    return re.sub(r'\s+', ' ', re.sub(r'^(Prof\.|Professor|Dr\.|Doctor|Lecturer)\s*', '', str(value or ''), flags=re.IGNORECASE)).strip().upper()


def normalize_position(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


VISUAL_PRIORITY_INDEX = {
    normalize_faculty_name(name): index
    for index, name in enumerate(HKBU_FACULTY_PRIORITY_LEFT_TO_RIGHT)
}


POSITION_BY_NORMALIZED_NAME = {
    normalize_faculty_name(name): normalize_position(position)
    for name, position in HKBU_FACULTY_POSITION_BY_NAME.items()
}


def get_faculty_position_priority(position):
    normalized = normalize_position(position)
    for pattern, priority in POSITION_PRIORITY_BUCKETS:
        if pattern.search(normalized):
            return priority
    return 999


def infer_professor_names_by_id(students):
    names_by_id = {}
    for student in students:
        supervisor_id = student.get('supervisorId')
        supervisor_name = student.get('supervisorName')
        observer_id = student.get('observerId')
        observer_name = student.get('observerName')
        if supervisor_id and supervisor_name and supervisor_id not in names_by_id:
            names_by_id[supervisor_id] = supervisor_name
        if observer_id and observer_name and observer_id not in names_by_id:
            names_by_id[observer_id] = observer_name
    return names_by_id


def build_professor_priority_context(students):
    names_by_id = infer_professor_names_by_id(students)
    context = {}
    for professor_id, professor_name in names_by_id.items():
        normalized_name = normalize_faculty_name(professor_name)
        visual_index = VISUAL_PRIORITY_INDEX.get(normalized_name, len(HKBU_FACULTY_PRIORITY_LEFT_TO_RIGHT) + 100)
        position = POSITION_BY_NORMALIZED_NAME.get(normalized_name, '')
        position_priority = get_faculty_position_priority(position)
        composite_rank = position_priority * 100 + visual_index
        priority_bonus = max(0, MAX_PRIORITY_BONUS - composite_rank)
        context[professor_id] = {
            'name': professor_name,
            'position': position,
            'positionPriority': position_priority,
            'visualPriorityIndex': visual_index,
            'priorityBonus': priority_bonus,
        }
    return context


def get_preference_weight(professor_id, prof_preferences, priority_context, prioritize_faculty=False):
    pref = prof_preferences.get(professor_id, {'type': 'CONCENTRATE', 'weight': 10})
    base_weight = int(pref.get('weight', 10) or 10)
    if not prioritize_faculty:
        return base_weight
    priority_bonus = priority_context.get(professor_id, {}).get('priorityBonus', 0)
    return base_weight * BASE_WEIGHT_SCALE + priority_bonus


def build_professor_stats(assignments):
    stats = {}
    for assignment in assignments:
        if not assignment:
            continue
        student = assignment['student']
        day = assignment['day']
        for professor_id in (student['supervisorId'], student['observerId']):
            if professor_id not in stats:
                stats[professor_id] = {'days': set(), 'dailyLoad': defaultdict(int)}
            stats[professor_id]['days'].add(day)
            stats[professor_id]['dailyLoad'][day] += 1
    return stats


def calculate_weighted_soft_cost(assignments, prof_preferences, priority_context, prioritize_faculty=False):
    if not prof_preferences:
        return None

    professor_stats = build_professor_stats(assignments)
    total_cost = 0

    for professor_id, stats in professor_stats.items():
        pref = prof_preferences.get(professor_id, {'type': 'CONCENTRATE', 'weight': 10})
        pref_type = pref.get('type', 'CONCENTRATE')
        weight = get_preference_weight(professor_id, prof_preferences, priority_context, prioritize_faculty)

        if pref_type == 'CONCENTRATE':
            if len(stats['days']) > 1:
                total_cost += (len(stats['days']) - 1) * weight
            continue

        if pref_type == 'MAX_PER_DAY':
            limit = int(pref.get('target', 3) or 3)
            for load in stats['dailyLoad'].values():
                if load > limit:
                    total_cost += (load - limit) * weight
            continue

        total_load = sum(stats['dailyLoad'].values())
        ideal_days = (total_load + 1) // 2
        if len(stats['days']) < ideal_days:
            total_cost += (ideal_days - len(stats['days'])) * weight

    return total_cost


def count_professor_student_loads(students):
    loads = defaultdict(int)
    for student in students:
        if student.get('supervisorId'):
            loads[student['supervisorId']] += 1
        if student.get('observerId'):
            loads[student['observerId']] += 1
    return loads