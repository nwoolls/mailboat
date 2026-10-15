//! Keeps one account's Gmail usage under Google's per-user quota.
//!
//! Gmail charges "quota units" per call (threads.get = 10, messages.get = 5,
//! ...) and allows about 15,000 units per minute per user (250/s). The pacer
//! is a token bucket: calls wait until enough units have accumulated. The
//! default rate stays well under the limit so the user's phone and other
//! Gmail apps, which share the same quota, keep working.

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
}

#[derive(Debug, Clone)]
pub struct QuotaPacer {
    units_per_sec: f64,
    capacity: f64,
    bucket: Arc<Mutex<Bucket>>,
}

impl Default for QuotaPacer {
    /// 150 units/s sustained (60% of Google's limit), bursts up to 600.
    fn default() -> Self {
        Self::new(150.0, 600.0)
    }
}

impl QuotaPacer {
    pub fn new(units_per_sec: f64, capacity: f64) -> Self {
        Self {
            units_per_sec,
            capacity,
            bucket: Arc::new(Mutex::new(Bucket {
                tokens: capacity,
                last: Instant::now(),
            })),
        }
    }

    /// For tests: never waits.
    pub fn unlimited() -> Self {
        Self::new(f64::INFINITY, f64::INFINITY)
    }

    /// Waits until `units` of quota are available, then spends them.
    pub async fn acquire(&self, units: u32) {
        if self.units_per_sec.is_infinite() {
            return;
        }
        // A single request bigger than the bucket still goes through once full.
        let units = (units as f64).min(self.capacity);
        let mut bucket = self.bucket.lock().await;
        loop {
            let now = Instant::now();
            let elapsed = now.duration_since(bucket.last).as_secs_f64();
            bucket.tokens = (bucket.tokens + elapsed * self.units_per_sec).min(self.capacity);
            bucket.last = now;
            if bucket.tokens >= units {
                bucket.tokens -= units;
                return;
            }
            let wait = (units - bucket.tokens) / self.units_per_sec;
            // Holding the lock while sleeping keeps callers in FIFO order.
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
        }
    }

    /// After Google reports a rate limit, assume the budget is used up.
    pub async fn drain(&self) {
        let mut bucket = self.bucket.lock().await;
        bucket.tokens = 0.0;
        bucket.last = Instant::now();
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
    }

    #[tokio::test(start_paused = true)]
    async fn drain_forces_a_pause() {
        let pacer = QuotaPacer::new(100.0, 100.0);
        pacer.drain().await;
        let start = Instant::now();
        pacer.acquire(50).await;
        assert_eq!(start.elapsed().as_millis(), 500);
    }
}
