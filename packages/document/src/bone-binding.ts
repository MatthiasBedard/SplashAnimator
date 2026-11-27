export type BoneBinding = {
  rigId: string;
  role: 'upper' | 'lower';
  start: 0 | 1;
  length: number;
};

export type BoneAttachment = {
  rigId: string;
  boneId: string;
  local: [number, number, number, number, number, number];
};

function savedOwnData(owner: object, name: string) {
  const property = Object.getOwnPropertyDescriptor(owner, name);
  return property?.enumerable && 'value' in property ? property : undefined;
}

export function validateBoneAttachment(owner: object): void {
  if (!('boneAttachment' in owner)) return;
  const property = savedOwnData(owner, 'boneAttachment');
  if (!property) throw Error('Invalid bone attachment.');
  const value = property.value as BoneAttachment | undefined;
  if (value === undefined) return;
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== 3 ||
      !['rigId', 'boneId', 'local'].every(key => savedOwnData(value, key)) ||
      typeof value.rigId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.rigId) ||
      typeof value.boneId !== 'string' || value.boneId.length < 1 || value.boneId.length > 200 ||
      !Array.isArray(value.local) || value.local.length !== 6 || Reflect.ownKeys(value.local).length !== 7 ||
      ![0, 1, 2, 3, 4, 5].every(index => Number.isFinite(savedOwnData(value.local, String(index))?.value)))
    throw Error('Invalid bone attachment.');
  const [a, b, c, d] = value.local;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10)
    throw Error('Invalid bone attachment basis.');
}

export function validateBoneBinding(owner: object): void {
  const property = Object.getOwnPropertyDescriptor(owner, 'bone');
  if (!property && !('bone' in owner)) return;
  if (!property?.enumerable || !('value' in property)) throw Error('Invalid bone binding.');
  const value = property.value as BoneBinding | undefined;
  if (value === undefined) return;
  const fields = ['rigId', 'role', 'start', 'length'] as const;
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length ||
      !fields.every(key => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        return field?.enumerable && 'value' in field;
      }) || typeof value.rigId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.rigId) ||
      (value.role !== 'upper' && value.role !== 'lower') || (value.start !== 0 && value.start !== 1) ||
      !Number.isFinite(value.length) || value.length <= 0)
    throw Error('Invalid bone binding.');
}
