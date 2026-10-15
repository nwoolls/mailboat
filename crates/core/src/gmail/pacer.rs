//! Keeps one account's Gmail usage under Google's per-user quota.
//!
//! Gmail charges "quota units" per call (threads.get = 10, messages.get = 5,
//! ...) per user. The owner's project allows 6,000 "units per minute per
//! user" (Google's docs say 15,000), and Google enforces it as a moving
//! average of about 100 units per second with almost no burst: a batch of
//! 200 units was refused after a nearly idle minute. The pacer is a token
//! bucket: calls wait until enough units have accumulated. The default stays
//! under that per-second budget, leaving room for the user's phone and other
//! Gmail apps on the same quota, and slows further if Google still refuses.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::time::Instant;

/// Gmail API quota costs (https://developers.google.com/gmail/api/reference/quota).
pub mod cost {
    pub const PROFILE: u32 = 1;
    pub const LABELS_LIST: u32 = 1;
    pub const HISTORY_LIST: u32 = 2;
    pub const MESSAGES_GET: u32 = 5;
    pub const THREADS_LIST: u32 = 10;
    pub const THREADS_GET: u32 = 10;
}

#[derive(Debug)]
struct Bucket {
    tokens: f64,
    last: Instant,
    /// Current rate; drops when Google says "slow down", then recovers.
    rate: f64,
    /// No requests at all until then (lets Google's quota window clear).
    paused_until: Option<Instant>,
    /// Units spent in the current one-minute reporting window.
    minute_start: Instant,
    minute_spent: f64,
}

/// Usage over the last minute, for the sync log.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MinuteReport {
    pub units: u32,
    pub rate: f64,
}

/// How fast the rate climbs back after a throttle (units/s gained per second).
const RECOVERY_PER_SEC: f64 = 1.0;
/// Never slow below this, so sync always makes progress.
const MIN_RATE: f64 = 10.0;

#[derive(Debug, Clone)]
pub struct QuotaPacer {
    max_rate: f64,
    capacity: f64,
    bucket: Arc<Mutex<Bucket>>,
}

impl Default for QuotaPacer {
    /// Up to 60 units/s (3,600/minute), bursts of at most 60 units.
    fn default() -> Self {
        Self::new(60.0, 60.0)
    }
}

impl QuotaPacer {
    pub fn new(units_per_sec: f64, capacity: f64) -> Self {
        Self {
            max_rate: units_per_sec,
            capacity,
            bucket: Arc::new(Mutex::new(Bucket {
                tokens: capacity,
                last: Instant::now(),
                rate: units_per_sec,
                paused_until: None,
                minute_start: Instant::now(),
                minute_spent: 0.0,
            })),
        }
    }

    /// For tests: never waits.
    pub fn unlimited() -> Self {
        Self::new(f64::INFINITY, f64::INFINITY)
    }

    /// Adds the tokens earned since the last call (nothing while paused).
    fn refill(&self, b: &mut Bucket, now: Instant) {
        if let Some(until) = b.paused_until {
            if now < until {
                return;
            }
            // Time spent paused doesn't earn tokens or speed; time after it does.
            b.paused_until = None;
            b.last = b.last.max(until);
        }
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.rate = (b.rate + elapsed * RECOVERY_PER_SEC).min(self.max_rate);
        b.tokens = (b.tokens + elapsed * b.rate).min(self.capacity);
        b.last = now;
    }

    fn spend(b: &mut Bucket, units: f64, now: Instant) -> Option<MinuteReport> {
        b.tokens -= units;
        b.minute_spent += units;
        if now.duration_since(b.minute_start) < Duration::from_secs(60) {
            return None;
        }
        let report = MinuteReport {
            units: b.minute_spent as u32,
            rate: b.rate,
        };
        b.minute_start = now;
        b.minute_spent = 0.0;
        Some(report)
    }

    /// Background work: waits until `units` of quota are available, then
    /// spends them. The lock is not held while waiting, so `acquire_now`
    /// callers are never stuck behind a waiting sync.
    /// Returns a usage report once per minute.
    pub async fn acquire(&self, units: u32) -> Option<MinuteReport> {
        if self.max_rate.is_infinite() {
            return None;
        }
        // A single request bigger than the bucket still goes through once full.
        let units = (units as f64).min(self.capacity);
        loop {
            let wait = {
                let mut b = self.bucket.lock().await;
                let now = Instant::now();
                match b.paused_until.filter(|until| *until > now) {
                    Some(until) => until - now,
                    None => {
                        self.refill(&mut b, now);
                        // Small tolerance so float rounding can't leave us a hair short.
                        if b.tokens + 1e-6 >= units {
                            return Self::spend(&mut b, units, now);
                        }
                        // Timers have 1ms resolution; never ask for less, or we'd spin.
                        Duration::from_secs_f64(((units - b.tokens) / b.rate).max(0.001))
                    }
                }
            };
            tokio::time::sleep(wait).await;
        }
    }

    /// Something the user is waiting for (opening a message): go now, even
    /// during a pause. The cost is still recorded (the balance may go
    /// negative), so background work slows down to make up for it.
    pub async fn acquire_now(&self, units: u32) -> Option<MinuteReport> {
        if self.max_rate.is_infinite() {
            return None;
        }
        let mut b = self.bucket.lock().await;
        let now = Instant::now();
        self.refill(&mut b, now);
        Self::spend(&mut b, units as f64, now)
    }

    /// Google reported a rate limit: send nothing for `pause`, then resume
    /// at half the rate. Returns the new rate (units/s), for logging.
    pub async fn throttle(&self, pause: Duration) -> f64 {
        let mut bucket = self.bucket.lock().await;
        bucket.tokens = 0.0;
        bucket.last = Instant::now();
        let until = Instant::now() + pause;
        bucket.paused_until = Some(bucket.paused_until.map_or(until, |p| p.max(until)));
        if bucket.rate.is_finite() {
            bucket.rate = (bucket.rate / 2.0).max(MIN_RATE);
        }
        bucket.rate
    }

    pub async fn current_rate(&self) -> f64 {
        self.bucket.lock().await.rate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn waits_once_the_burst_is_spent() {
        let pacer = QuotaPacer::new(100.0, 200.0);
        let start = Instant::now();
        pacer.acquire(200).await; // burst
        assert_eq!(start.elapsed(), Duration::ZERO);
        pacer.acquire(100).await; // needs 1s of refill
        assert_eq!(start.elapsed().as_millis(), 1000);
        pacer.acquire(50).await;
        assert_eq!(start.elapsed().as_millis(), 1500);
    }

    #[tokio::test(start_paused = true)]
    async fn sustained_rate_is_respected() {
        let pacer = QuotaPacer::new(150.0, 600.0);
        let start = Instant::now();
        // 6,000 units of threads.get = 600 threads.
        for _ in 0..600 {
            pacer.acquire(cost::THREADS_GET).await;
        }
        // (6000 - 600 burst) / 150 per second = 36s.
        assert_eq!(start.elapsed().as_secs(), 36);
        // Default settings keep any one minute well under the 6,000 limit.
        let default = QuotaPacer::default();
        let start = Instant::now();
        let mut spent = 0;
        while start.elapsed() < Duration::from_secs(60) {
            default.acquire(cost::THREADS_GET).await;
            spent += cost::THREADS_GET;
        }
        assert!(spent <= 6_000 * 3 / 4, "{spent} units in a minute");
    }

    #[tokio::test(start_paused = true)]
    async fn throttle_pauses_halves_the_rate_then_recovers() {
        let pacer = QuotaPacer::new(100.0, 100.0);
        assert_eq!(pacer.throttle(Duration::ZERO).await, 50.0);
        let start = Instant::now();
        pacer.acquire(50).await;
        // ~1s at 50/s, a little less because the rate recovers meanwhile.
        let ms = start.elapsed().as_millis();
        assert!((900..=1000).contains(&ms), "{ms}");
        assert_eq!(pacer.throttle(Duration::ZERO).await.round(), 26.0);
        for _ in 0..8 {
            pacer.throttle(Duration::ZERO).await;
        }
        assert_eq!(pacer.current_rate().await, 10.0, "never below the floor");
        tokio::time::sleep(Duration::from_secs(100)).await;
        pacer.acquire(1).await;
        assert_eq!(
            pacer.current_rate().await,
            100.0,
            "back to full speed after ~90s"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn per_minute_limit_pauses_everything() {
        let pacer = QuotaPacer::new(100.0, 100.0);
        pacer.throttle(Duration::from_secs(60)).await;
        let start = Instant::now();
        pacer.acquire(10).await;
        // 60s pause, then 10 units at 50/s.
        assert_eq!(start.elapsed().as_millis(), 60_200);
    }

    #[tokio::test(start_paused = true)]
    async fn reports_usage_once_a_minute() {
        let pacer = QuotaPacer::new(100.0, 100.0);
        let mut reports = Vec::new();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(125) {
            if let Some(r) = pacer.acquire(10).await {
                reports.push(r.units);
            }
        }
        assert_eq!(reports.len(), 2);
        assert!(
            reports.iter().all(|u| (6_000..=6_200).contains(u)),
            "{reports:?}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn interactive_requests_skip_the_queue_and_pauses() {
        let pacer = QuotaPacer::new(10.0, 10.0);
        pacer.throttle(Duration::from_secs(60)).await;
        // A background request is waiting out the pause...
        let background = {
            let pacer = pacer.clone();
            tokio::spawn(async move {
                let start = Instant::now();
                pacer.acquire(10).await;
                start.elapsed()
            })
        };
        tokio::task::yield_now().await;
        // ...but opening a message goes immediately.
        let start = Instant::now();
        pacer.acquire_now(5).await;
        assert_eq!(start.elapsed(), Duration::ZERO);
        // Background pays for it: the 60s pause, then 15 units (its 10 plus
        // the 5 owed) at the 10 units/s floor = 61.5s instead of 61s.
        assert_eq!(background.await.unwrap().as_millis(), 61_500);
    }
}
