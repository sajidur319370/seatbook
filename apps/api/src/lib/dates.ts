export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const subSeconds = (d: Date, n: number) => new Date(d.getTime() - n * 1000);
export const subDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);
