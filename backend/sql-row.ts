export type SqlValue = string | number | bigint | null;
export type SqlRow = Record<string, SqlValue>;

export function readString(row: SqlRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

export function readNullableString(row: SqlRow, key: string): string | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a nullable string`);
    }
    return value;
}

export function readNumber(row: SqlRow, key: string): number {
    const value = row[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a number`);
}

export function readNullableNumber(row: SqlRow, key: string): number | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a nullable number`);
}

export function readBoolean(row: SqlRow, key: string): boolean {
    return readNumber(row, key) === 1;
}

export function readNullableAggregate(row: SqlRow, key: string): number {
    const value = row[key];
    if (value === null) {
        return 0;
    }
    return readNumber(row, key);
}
