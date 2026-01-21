/**
 * Scheduled Retraining Service
 * Handles automatic retraining of AI categorization on a schedule
 * Uses node-cron for scheduling
 */

import cron from 'node-cron';
import enhancedAI from './enhancedAICategorizationService.js';
import * as database from '../src/database.js';

class ScheduledRetrainingService {
    constructor() {
        this.dailyRetrainingJob = null;
        this.periodicCheckJob = null;
        this.isRetraining = false;
    }

    /**
     * Start all scheduled jobs
     */
    start() {
        console.log('🕐 Starting scheduled retraining service...');

        // Daily retraining at 2 AM
        this.dailyRetrainingJob = cron.schedule('0 2 * * *', async () => {
            console.log('⏰ Daily retraining triggered at 2 AM');
            await this.performRetraining('daily_scheduled');
        });

        // Check correction threshold every 5 minutes
        this.periodicCheckJob = cron.schedule('*/5 * * * *', async () => {
            await this.checkAndRetrain();
        });

        console.log('✓ Scheduled retraining service started');
        console.log('  - Daily retraining: 2:00 AM');
        console.log('  - Threshold check: Every 5 minutes');
    }

    /**
     * Stop all scheduled jobs
     */
    stop() {
        console.log('🛑 Stopping scheduled retraining service...');

        if (this.dailyRetrainingJob) {
            this.dailyRetrainingJob.stop();
            this.dailyRetrainingJob = null;
        }

        if (this.periodicCheckJob) {
            this.periodicCheckJob.stop();
            this.periodicCheckJob = null;
        }

        console.log('✓ Scheduled retraining service stopped');
    }

    /**
     * Check if correction threshold is reached and retrain if necessary
     */
    async checkAndRetrain() {
        if (this.isRetraining) {
            // Already retraining, skip
            return;
        }

        try {
            const feedbackCount = database.getFeedbackCountSinceLastTraining();
            const threshold = enhancedAI.getRetrainingThreshold();

            if (feedbackCount >= threshold) {
                console.log(`🔄 Threshold reached: ${feedbackCount}/${threshold} corrections`);
                await this.performRetraining('threshold_triggered');
            }
        } catch (error) {
            console.error('Error checking retraining threshold:', error);
        }
    }

    /**
     * Perform retraining
     */
    async performRetraining(triggerType = 'manual') {
        if (this.isRetraining) {
            console.log('⚠️  Retraining already in progress, skipping');
            return;
        }

        this.isRetraining = true;

        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`🎯 RETRAINING STARTED (${triggerType})`);
            console.log(`${'='.repeat(60)}\n`);

            const startTime = Date.now();

            // Perform retraining
            await enhancedAI.retrain();

            const duration = Date.now() - startTime;

            console.log(`\n${'='.repeat(60)}`);
            console.log(`✅ RETRAINING COMPLETE (${duration}ms)`);
            console.log(`${'='.repeat(60)}\n`);
        } catch (error) {
            console.error('❌ Retraining failed:', error);
        } finally {
            this.isRetraining = false;
        }
    }

    /**
     * Get status of scheduled jobs
     */
    getStatus() {
        const feedbackCount = database.getFeedbackCountSinceLastTraining();
        const threshold = enhancedAI.getRetrainingThreshold();
        const lastTraining = database.getLastTrainingTimestamp();

        return {
            running: !!(this.dailyRetrainingJob || this.periodicCheckJob),
            isRetraining: this.isRetraining,
            feedbackCount,
            threshold,
            nextRetrainingIn: threshold - feedbackCount,
            lastTraining,
            dailySchedule: '2:00 AM',
            periodicCheck: 'Every 5 minutes'
        };
    }

    /**
     * Manually trigger retraining
     */
    async manualRetrain() {
        await this.performRetraining('manual');
    }
}

// Export singleton instance
const scheduledRetrainingService = new ScheduledRetrainingService();
export default scheduledRetrainingService;
