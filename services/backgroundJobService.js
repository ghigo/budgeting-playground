/**
 * Background Job Service
 * Manages long-running background jobs with progress tracking
 */

class BackgroundJobService {
    constructor() {
        this.jobs = new Map();
        this.nextJobId = 1;
    }

    /**
     * Create a new background job
     * @param {string} type - Job type (e.g., 'amazon-item-categorization')
     * @param {Object} metadata - Additional job metadata
     * @returns {string} Job ID
     */
    createJob(type, metadata = {}) {
        const jobId = `job_${this.nextJobId++}`;
        const job = {
            id: jobId,
            type,
            status: 'pending',
            progress: 0,
            total: 0,
            processed: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
            result: null,
            metadata
        };

        this.jobs.set(jobId, job);
        console.log(`[Background Job] Created job ${jobId} of type ${type}`);
        return jobId;
    }

    /**
     * Update job progress
     * @param {string} jobId - Job ID
     * @param {Object} updates - Updates to apply
     */
    updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) {
            console.error(`[Background Job] Job ${jobId} not found`);
            return;
        }

        Object.assign(job, updates);

        // Calculate progress percentage
        if (job.total > 0) {
            job.progress = Math.round((job.processed / job.total) * 100);
        }

        // Set completion time if status is completed or failed
        if ((updates.status === 'completed' || updates.status === 'failed') && !job.completedAt) {
            job.completedAt = new Date().toISOString();
        }
    }

    /**
     * Mark job as running
     * @param {string} jobId - Job ID
     * @param {number} total - Total items to process
     */
    startJob(jobId, total) {
        this.updateJob(jobId, {
            status: 'running',
            total,
            processed: 0,
            progress: 0
        });
    }

    /**
     * Increment job progress
     * @param {string} jobId - Job ID
     * @param {number} increment - Amount to increment (default: 1)
     */
    incrementProgress(jobId, increment = 1) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        this.updateJob(jobId, {
            processed: job.processed + increment
        });
    }

    /**
     * Mark job as completed
     * @param {string} jobId - Job ID
     * @param {Object} result - Job result
     */
    completeJob(jobId, result) {
        this.updateJob(jobId, {
            status: 'completed',
            result,
            progress: 100
        });
        console.log(`[Background Job] Job ${jobId} completed successfully`);
    }

    /**
     * Mark job as failed
     * @param {string} jobId - Job ID
     * @param {Error|string} error - Error that caused failure
     */
    failJob(jobId, error) {
        this.updateJob(jobId, {
            status: 'failed',
            error: error instanceof Error ? error.message : error
        });
        console.error(`[Background Job] Job ${jobId} failed:`, error);
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status or null if not found
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Delete old completed jobs (cleanup)
     * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
     */
    cleanupOldJobs(maxAgeMs = 3600000) {
        const now = Date.now();
        const deleted = [];

        for (const [jobId, job] of this.jobs.entries()) {
            if (job.status === 'completed' || job.status === 'failed') {
                const completedTime = new Date(job.completedAt).getTime();
                if (now - completedTime > maxAgeMs) {
                    this.jobs.delete(jobId);
                    deleted.push(jobId);
                }
            }
        }

        if (deleted.length > 0) {
            console.log(`[Background Job] Cleaned up ${deleted.length} old jobs`);
        }
    }
}

// Export singleton instance
export const backgroundJobService = new BackgroundJobService();

// Run cleanup every 30 minutes
setInterval(() => {
    backgroundJobService.cleanupOldJobs();
}, 30 * 60 * 1000);
