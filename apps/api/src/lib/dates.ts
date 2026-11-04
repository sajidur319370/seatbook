export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
