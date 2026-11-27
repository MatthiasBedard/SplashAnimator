import type { Point } from '../packages/document/src';

const points = (coordinates: number[][]): Point[] => coordinates.map(([x, y]) => ({ x, y }));
export const horizontal = points([[40,120],[110,120],[180,120],[250,120]]);
export const vertical = points([[145,45],[145,95],[145,145],[145,195]]);
export const diagonal = points([[60,48],[110,90],[170,143],[223,190]]);
export const arc = points([[80,55],[95,75],[124,87],[157,93],[180,110],[196,153],[210,176]]);
