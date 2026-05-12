import { computeMaxDensityPeriod } from './src/lib/adoptionFilters';

const runTests = () => {
    console.log("Running Sliding Window Tests...");

    const check = (name: string, records: any[], limitDays: number, expectedCount: number, expectedSpanDays: number) => {
        const res = computeMaxDensityPeriod(records, 'adoption', limitDays);
        const pass = res.count === expectedCount && Math.round(res.timeSpanDays || 0) === expectedSpanDays;
        console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
        if (!pass) {
            console.log(`   Expected: count=${expectedCount}, span=${expectedSpanDays}`);
            console.log(`   Got: count=${res.count}, span=${Math.round(res.timeSpanDays || 0)}`);
        }
    };

    const d = (str: string) => new Date(str).getTime() / 1000; // Unix format used historically

    // Case 1: 5 adoptions span 91 days (limit 90). Should only capture 4 max.
    check("Case 1: Spanning too long", [
        { recordType: 'adoption', date: d("2026-01-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-01-20T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-02-10T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-03-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-04-02T00:00:00Z") }, // 91 days from Jan 1
    ], 90, 4, 71); // Jan 20 to Apr 2 is 72 days, returning 4 items

    // Case 2: Dense History
    check("Case 2: Dense history cluster", [
        { recordType: 'adoption', date: d("2024-01-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2024-05-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2024-09-01T00:00:00Z") },
        // Cluster in 2022
        { recordType: 'adoption', date: d("2022-05-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2022-05-02T00:00:00Z") },
        { recordType: 'adoption', date: d("2022-05-05T00:00:00Z") },
        { recordType: 'adoption', date: d("2022-05-10T00:00:00Z") },
        { recordType: 'adoption', date: d("2022-05-12T00:00:00Z") },
    ], 20, 5, 11);

    // Case 3: Exact Spacing
    check("Case 3: Exact Edge overlap", [
        { recordType: 'adoption', date: d("2026-01-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-01-21T00:00:00Z") }, // Extactly 20 days apart
    ], 20, 2, 20);

    // Case 4: Duplicate Timestamps
    check("Case 4: Duplicates", [
        { recordType: 'adoption', date: d("2026-01-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-01-01T00:00:00Z") },
        { recordType: 'adoption', date: d("2026-01-01T00:00:00Z") },
    ], 20, 3, 0);
};

runTests();
