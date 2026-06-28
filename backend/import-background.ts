const activeImportTasks = new Map<string, Promise<void>>();

export function reserveImportTask(jobId: string): (task: Promise<void>) => void {
    if (activeImportTasks.has(jobId)) {
        throw new Error("Import job already has an active task.");
    }
    activeImportTasks.set(jobId, Promise.resolve());

    return (task: Promise<void>) => {
        trackImportTask(jobId, task);
    };
}

function trackImportTask(jobId: string, task: Promise<void>): void {
    activeImportTasks.set(jobId, task);
    task.catch((error) => {
        console.error(`Import job ${jobId} failed:`, error);
    }).finally(() => {
        activeImportTasks.delete(jobId);
    });
}

export function releaseReservedImportTask(jobId: string): void {
    activeImportTasks.delete(jobId);
}
