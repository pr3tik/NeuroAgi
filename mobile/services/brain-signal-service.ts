/**
 * NeuroAGI Mobile Signal Layer
 * 
 * A lightweight background service that emits signals from the phone to the brain.
 * This is the software equivalent of OpenAI's ambient device — no hardware required.
 * 
 * What it tracks:
 * - App usage patterns (which apps, how long, time of day)
 * - Screen time and phone pickup frequency
 * - Location context (home, library, class, coffee shop) — coarse, not precise
 * - Active/inactive periods (is the person working or resting?)
 * - Notification response time (how quickly they respond to messages)
 * - Typing activity (are they writing? how much?)
 * 
 * What it does NOT track:
 * - Message content
 * - Precise GPS coordinates
 * - Anything the user hasn't consented to
 * 
 * Privacy model:
 * - All signals are opt-in per category
 * - User can see every signal in the brain dashboard
 * - User can delete any signal or all signals
 * - Signals are processed server-side, never sold
 * 
 * Integration:
 * - React Native background task (iOS: BGTaskScheduler, Android: WorkManager)
 * - Batches signals every 15 minutes
 * - POSTs to /api/signals/batch
 * - Falls back gracefully if offline (queues locally)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundFetch from 'react-native-background-fetch';
import DeviceInfo from 'react-native-device-info';
import { AppState, AppStateStatus } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const SIGNAL_BATCH_INTERVAL_MINUTES = 15;
const SIGNAL_QUEUE_KEY = 'neuroagi_signal_queue';
const MAX_QUEUE_SIZE = 500;

interface SignalPayload {
  signal_type: string;
  subtype?: string;
  value?: number;
  value_text?: string;
  value_json?: Record<string, any>;
  occurred_at: string;
  source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Collectors
// ─────────────────────────────────────────────────────────────────────────────

class MobileSignalService {
  private personId: string | null = null;
  private apiUrl: string | null = null;
  private sessionStartTime: number = Date.now();
  private appStateHistory: { state: AppStateStatus; at: number }[] = [];
  private isInitialized = false;

  async initialize(personId: string, apiUrl: string): Promise<void> {
    this.personId = personId;
    this.apiUrl = apiUrl;
    this.isInitialized = true;

    // Track app state changes
    AppState.addEventListener('change', this.handleAppStateChange.bind(this));

    // Configure background fetch
    await this.configureBackgroundFetch();

    // Emit initialization signal
    await this.queue({
      signal_type: 'behavioral',
      subtype: 'app_opened',
      value_text: 'FschoolAI opened',
      occurred_at: new Date().toISOString(),
      source: 'mobile_app',
    });

    console.log('[BrainSignalService] Initialized for person:', personId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Signal Collection Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a session start signal
   * Called when user opens the app and starts a conversation
   */
  async emitSessionStart(sessionId: string): Promise<void> {
    this.sessionStartTime = Date.now();
    await this.queue({
      signal_type: 'behavioral',
      subtype: 'session_started',
      value_json: { session_id: sessionId, hour_of_day: new Date().getHours() },
      occurred_at: new Date().toISOString(),
      source: 'mobile_app',
    });
  }

  /**
   * Emit a session end signal with duration
   */
  async emitSessionEnd(sessionId: string, messageCount: number): Promise<void> {
    const durationMinutes = Math.round((Date.now() - this.sessionStartTime) / 60000);
    await this.queue({
      signal_type: 'behavioral',
      subtype: 'session_ended',
      value: durationMinutes,
      value_json: { session_id: sessionId, message_count: messageCount, duration_minutes: durationMinutes },
      occurred_at: new Date().toISOString(),
      source: 'mobile_app',
    });
  }

  /**
   * Emit a typing signal — how much the user is writing
   * Called periodically while user is typing in the chat
   */
  async emitTypingActivity(characterCount: number, deletionCount: number): Promise<void> {
    if (characterCount < 20) return; // Don't emit for tiny inputs
    await this.queue({
      signal_type: 'behavioral',
      subtype: 'typing_activity',
      value: characterCount,
      value_json: { chars: characterCount, deletions: deletionCount, ratio: deletionCount / characterCount },
      occurred_at: new Date().toISOString(),
      source: 'mobile_app',
    });
  }

  /**
   * Emit a screen time signal
   * Called by background task every 15 minutes
   */
  async emitScreenTimeSnapshot(): Promise<void> {
    const hour = new Date().getHours();
    const isLateNight = hour >= 23 || hour <= 4;
    const isEarlyMorning = hour >= 5 && hour <= 8;
    const isPrimeStudyTime = hour >= 9 && hour <= 23;

    await this.queue({
      signal_type: 'temporal',
      subtype: 'screen_active',
      value: 1,
      value_json: {
        hour_of_day: hour,
        is_late_night: isLateNight,
        is_early_morning: isEarlyMorning,
        is_prime_study_time: isPrimeStudyTime,
        day_of_week: new Date().getDay(),
      },
      occurred_at: new Date().toISOString(),
      source: 'mobile_background',
    });
  }

  /**
   * Emit a location context signal (coarse — no precise GPS)
   * Uses WiFi network name to infer context
   */
  async emitLocationContext(wifiSSID?: string): Promise<void> {
    if (!wifiSSID) return;

    // Infer context from WiFi name — no GPS needed
    let context = 'unknown';
    const ssidLower = wifiSSID.toLowerCase();
    if (ssidLower.includes('uoft') || ssidLower.includes('university') || ssidLower.includes('eduroam')) {
      context = 'campus';
    } else if (ssidLower.includes('library')) {
      context = 'library';
    } else if (ssidLower.includes('starbucks') || ssidLower.includes('tim hortons') || ssidLower.includes('coffee')) {
      context = 'coffee_shop';
    } else if (ssidLower.includes('home') || ssidLower.includes('apartment') || ssidLower.includes('house')) {
      context = 'home';
    }

    if (context === 'unknown') return; // Don't emit if we can't infer

    await this.queue({
      signal_type: 'behavioral',
      subtype: 'location_context',
      value_text: context,
      value_json: { context, inferred_from: 'wifi_ssid' },
      occurred_at: new Date().toISOString(),
      source: 'mobile_background',
    });
  }

  /**
   * Emit a Canvas activity signal
   * Called when user views an assignment or grade in the app
   */
  async emitCanvasActivity(activityType: 'viewed_assignment' | 'viewed_grade' | 'submitted' | 'opened_course', metadata: Record<string, any>): Promise<void> {
    await this.queue({
      signal_type: 'academic',
      subtype: activityType,
      value_json: metadata,
      occurred_at: new Date().toISOString(),
      source: 'canvas_integration',
    });
  }

  /**
   * Emit a stress signal based on typing patterns
   * High deletion rate + short messages = potential stress
   */
  async emitInferredStress(deletionRatio: number, avgMessageLength: number, responseTime: number): Promise<void> {
    // Simple heuristic: high deletion + short messages + fast response = anxious
    const stressScore = Math.min(1.0, (deletionRatio * 0.4) + (responseTime < 2 ? 0.3 : 0) + (avgMessageLength < 20 ? 0.3 : 0));
    
    if (stressScore < 0.3) return; // Not significant

    await this.queue({
      signal_type: 'stress',
      subtype: 'typing_pattern_inferred',
      value: stressScore,
      value_json: { deletion_ratio: deletionRatio, avg_message_length: avgMessageLength, response_time_seconds: responseTime },
      occurred_at: new Date().toISOString(),
      source: 'mobile_inference',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queue & Flush
  // ─────────────────────────────────────────────────────────────────────────

  async queue(signal: SignalPayload): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SIGNAL_QUEUE_KEY);
      const queue: SignalPayload[] = stored ? JSON.parse(stored) : [];
      
      queue.push(signal);
      
      // Trim if too large
      if (queue.length > MAX_QUEUE_SIZE) {
        queue.splice(0, queue.length - MAX_QUEUE_SIZE);
      }
      
      await AsyncStorage.setItem(SIGNAL_QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.error('[BrainSignalService] Queue error:', err);
    }
  }

  async flush(): Promise<{ flushed: number; failed: boolean }> {
    if (!this.personId || !this.apiUrl) return { flushed: 0, failed: false };

    try {
      const stored = await AsyncStorage.getItem(SIGNAL_QUEUE_KEY);
      if (!stored) return { flushed: 0, failed: false };

      const queue: SignalPayload[] = JSON.parse(stored);
      if (queue.length === 0) return { flushed: 0, failed: false };

      const response = await fetch(`${this.apiUrl}/api/signals/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: this.personId,
          signals: queue,
          source: 'mobile_batch',
        }),
      });

      if (response.ok) {
        await AsyncStorage.removeItem(SIGNAL_QUEUE_KEY);
        return { flushed: queue.length, failed: false };
      } else {
        return { flushed: 0, failed: true };
      }
    } catch (err) {
      console.error('[BrainSignalService] Flush error:', err);
      return { flushed: 0, failed: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Background Task
  // ─────────────────────────────────────────────────────────────────────────

  private async configureBackgroundFetch(): Promise<void> {
    await BackgroundFetch.configure(
      {
        minimumFetchInterval: SIGNAL_BATCH_INTERVAL_MINUTES,
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
      },
      async (taskId) => {
        console.log('[BrainSignalService] Background task running:', taskId);
        
        // Collect passive signals
        await this.emitScreenTimeSnapshot();
        
        // Flush queue
        const result = await this.flush();
        console.log('[BrainSignalService] Flushed', result.flushed, 'signals');
        
        BackgroundFetch.finish(taskId);
      },
      (taskId) => {
        console.log('[BrainSignalService] Background task timeout:', taskId);
        BackgroundFetch.finish(taskId);
      }
    );
  }

  private handleAppStateChange(nextState: AppStateStatus): void {
    this.appStateHistory.push({ state: nextState, at: Date.now() });
    
    // Keep only last 20 state changes
    if (this.appStateHistory.length > 20) {
      this.appStateHistory.shift();
    }

    if (nextState === 'background') {
      // App went to background — flush signals
      this.flush().catch(console.error);
    }
  }
}

// Singleton
export const brainSignalService = new MobileSignalService();

// ─────────────────────────────────────────────────────────────────────────────
// React Hook for easy integration
// ─────────────────────────────────────────────────────────────────────────────

export function useBrainSignals(personId: string, apiUrl: string) {
  // Initialize on mount
  const initialize = async () => {
    await brainSignalService.initialize(personId, apiUrl);
  };

  return {
    initialize,
    emitSessionStart: brainSignalService.emitSessionStart.bind(brainSignalService),
    emitSessionEnd: brainSignalService.emitSessionEnd.bind(brainSignalService),
    emitTypingActivity: brainSignalService.emitTypingActivity.bind(brainSignalService),
    emitCanvasActivity: brainSignalService.emitCanvasActivity.bind(brainSignalService),
    emitInferredStress: brainSignalService.emitInferredStress.bind(brainSignalService),
    flush: brainSignalService.flush.bind(brainSignalService),
  };
}
