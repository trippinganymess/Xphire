/** Fixed discovery choices shared by browser and server. Never promise live yield. */
export const PRIVATE_DISCOVERY_PRESETS = [
  { value: 'frontend and python developer', label: 'Frontend + Python developer', titles: ['frontend developer', 'python developer'] },
  { value: 'frontend developer', label: 'Frontend developer', titles: ['frontend developer', 'front end developer'] },
  { value: 'python developer', label: 'Python developer', titles: ['python developer', 'django developer'] },
  { value: 'backend developer', label: 'Backend developer', titles: ['backend developer', 'back end developer'] },
  { value: 'full stack developer', label: 'Full stack developer', titles: ['full stack developer', 'fullstack developer'] },
  { value: 'software engineer', label: 'Software engineer', titles: ['software engineer', 'software developer'] },
  { value: 'react developer', label: 'React developer', titles: ['react developer', 'reactjs developer'] },
  { value: 'java developer', label: 'Java developer', titles: ['java developer', 'spring developer'] },
  { value: 'qa engineer', label: 'QA / software testing', titles: ['qa engineer', 'software tester'] },
  { value: 'data analyst', label: 'Data analyst', titles: ['data analyst', 'business analyst'] },
] as const;

export type PrivateDiscoveryQuery = typeof PRIVATE_DISCOVERY_PRESETS[number]['value'];
export const DEFAULT_PRIVATE_DISCOVERY = PRIVATE_DISCOVERY_PRESETS[0].value;
export function privateDiscoveryPreset(query: string) {
  return PRIVATE_DISCOVERY_PRESETS.find((preset) => preset.value === query);
}
