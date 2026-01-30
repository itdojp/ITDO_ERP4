const DEFAULT_GROUP_TO_ROLE_MAP: Record<string, string> = {
  admin: 'admin',
  mgmt: 'mgmt',
  exec: 'exec',
  hr: 'hr',
  'hr-group': 'hr',
};

export function parseGroupToRoleMap(raw: string) {
  const map = { ...DEFAULT_GROUP_TO_ROLE_MAP };
  raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      const [groupIdRaw, roleRaw] = token.split('=');
      const groupId = groupIdRaw?.trim();
      const role = roleRaw?.trim();
      if (!groupId || !role) return;
      map[groupId] = role;
    });
  return map;
}
