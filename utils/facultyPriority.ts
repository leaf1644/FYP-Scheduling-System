export const HKBU_FACULTY_PRIORITY_SOURCE_URL = 'https://www.comp.hkbu.edu.hk/v1/?page=faculty';

// Extracted from the regular faculty page in visual card order, interpreted row by row
// from left to right and then top to bottom.
export const HKBU_FACULTY_PRIORITY_LEFT_TO_RIGHT: string[] = [
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
];

export interface FacultyPriorityRecord {
  name: string;
  position: string;
}

export const HKBU_FACULTY_POSITION_PRIORITY: FacultyPriorityRecord[] = [
  { name: 'Prof. XU, Jianliang', position: 'Head & Chair Professor' },
  { name: 'Prof. CHOI, Byron Koon Kau', position: 'Associate Head (Teaching and Learning) and Professor' },
  { name: 'Prof. CHEN, Li', position: 'Associate Head (Research) and Professor' },
  { name: 'Prof. WONG, Martin Ding Fat', position: 'Provost and Chair Professor' },
  { name: 'Prof. LIU, Jiming', position: 'Associate Provost and Chair Professor' },
  { name: 'Prof. CHEUNG, William Kwok Wai', position: 'Associate Vice-President (Transdisciplinary Education) and Professor' },
  { name: 'Prof. CHEUNG, Yiu Ming', position: 'Chair Professor' },
  { name: 'Prof. YUEN, Pong Chi', position: 'Chair Professor' },
  { name: 'Prof. NG, Michael Kwok Po', position: 'Chair Professor (Affiliate)' },
  { name: 'Prof. LEUNG, Yiu Wing', position: 'Professor' },
  { name: "Prof. D'INVERNO, Mark", position: 'Professor (Affiliate)' },
  { name: 'Prof. KENDERDINE, Sarah Irene Brutton', position: 'Visiting Professor' },
  { name: 'Prof. CHEN, Jie', position: 'Associate Professor' },
  { name: 'Prof. DAI, Henry Hong Ning', position: 'Associate Professor' },
  { name: 'Prof. HAN, Bo', position: 'Associate Professor' },
  { name: 'Prof. HUANG, Xin', position: 'Associate Professor' },
  { name: 'Prof. ZHANG, Eric Lu', position: 'Associate Professor' },
  { name: 'Prof. CHEN, Yifan', position: 'Assistant Professor' },
  { name: 'Prof. GUO, Xiaoqing', position: 'Assistant Professor' },
  { name: 'Prof. HUANG, Longkai', position: 'Assistant Professor' },
  { name: 'Prof. LIU, Jinwei', position: 'Assistant Professor' },
  { name: 'Prof. LIU, Yang', position: 'Assistant Professor' },
  { name: 'Prof. MA, Jing', position: 'Assistant Professor' },
  { name: 'Prof. WAN, Renjie', position: 'Assistant Professor' },
  { name: 'Prof. WANG, Juncheng', position: 'Assistant Professor' },
  { name: 'Prof. YANG, Renchi', position: 'Assistant Professor' },
  { name: 'Prof. ZHOU, Amelie Chi', position: 'Assistant Professor' },
  { name: 'Prof. ZHOU, Kaiyang', position: 'Assistant Professor' },
  { name: 'Dr. PIAO, Chengzhi', position: 'Research Assistant Professor' },
  { name: 'Dr. YIN, Kejing', position: 'Research Assistant Professor' },
  { name: 'Dr. CHOY, Martin Man Ting', position: 'Senior Lecturer' },
  { name: 'Dr. LAI, Jean Hok Yin', position: 'Senior Lecturer' },
  { name: 'Dr. LI, Kristen Yuanxi', position: 'Senior Lecturer' },
  { name: 'Dr. CHAN, Jacky Chun Pong', position: 'Lecturer' },
  { name: 'Dr. MA, Shichao', position: 'Lecturer' },
  { name: 'Dr. SHEK, Sarah Pui Wah', position: 'Lecturer' },
  { name: 'Dr. WANG, Kevin King Hang', position: 'Lecturer' },
  { name: 'Dr. XIAN, Poline Yin', position: 'Lecturer' },
  { name: 'Dr. YU, Wilson Shih Bun', position: 'Lecturer' },
  { name: 'Dr. ZHANG, Ce', position: 'Lecturer' },
];

const positionPriorityBuckets: Array<[pattern: RegExp, priority: number]> = [
  [/head\s*&\s*chair professor/i, 0],
  [/provost\s+and\s+chair professor/i, 1],
  [/associate provost\s+and\s+chair professor/i, 2],
  [/associate head.*professor/i, 3],
  [/associate vice-president.*professor/i, 4],
  [/chair professor/i, 5],
  [/associate professor/i, 7],
  [/research assistant professor/i, 8],
  [/assistant professor/i, 8],
  [/senior lecturer/i, 10],
  [/lecturer/i, 11],
  [/visiting professor/i, 12],
  [/professor/i, 6],
];

export const normalizeFacultyPriorityName = (value: string): string => {
  return String(value || '')
    .replace(/^(Prof\.|Professor|Dr\.|Doctor|Lecturer)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
};

export const normalizeFacultyPosition = (value: string): string => {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const HKBU_FACULTY_PRIORITY_INDEX: Record<string, number> = HKBU_FACULTY_PRIORITY_LEFT_TO_RIGHT.reduce(
  (accumulator, name, index) => {
    accumulator[normalizeFacultyPriorityName(name)] = index;
    return accumulator;
  },
  {} as Record<string, number>
);

export const getFacultyPriorityIndex = (professorName: string): number => {
  const normalizedName = normalizeFacultyPriorityName(professorName);
  return HKBU_FACULTY_PRIORITY_INDEX[normalizedName] ?? Number.MAX_SAFE_INTEGER;
};

export const HKBU_FACULTY_POSITION_BY_NAME: Record<string, string> = HKBU_FACULTY_POSITION_PRIORITY.reduce(
  (accumulator, record) => {
    accumulator[normalizeFacultyPriorityName(record.name)] = normalizeFacultyPosition(record.position);
    return accumulator;
  },
  {} as Record<string, string>
);

export const getFacultyPosition = (professorName: string): string | undefined => {
  return HKBU_FACULTY_POSITION_BY_NAME[normalizeFacultyPriorityName(professorName)];
};

export const getFacultyPositionPriority = (position: string | undefined): number => {
  const normalizedPosition = normalizeFacultyPosition(position || '');
  const matchedBucket = positionPriorityBuckets.find(([pattern]) => pattern.test(normalizedPosition));
  return matchedBucket ? matchedBucket[1] : Number.MAX_SAFE_INTEGER;
};

export const getFacultyRolePriorityIndex = (professorName: string): number => {
  return getFacultyPositionPriority(getFacultyPosition(professorName));
};

export const compareFacultyPriority = (leftProfessorName: string, rightProfessorName: string): number => {
  const roleDifference = getFacultyRolePriorityIndex(leftProfessorName) - getFacultyRolePriorityIndex(rightProfessorName);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  return getFacultyPriorityIndex(leftProfessorName) - getFacultyPriorityIndex(rightProfessorName);
};