use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SelectOutcome {
  Success,
  Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RoutingMode {
  Clash,
  Direct,
}

#[derive(Debug, Clone)]
struct CircuitBreaker {
  failure_threshold: usize,
  recovery_success_needed: usize,
  consecutive_failures: usize,
  consecutive_recovery_successes: usize,
  open: bool,
}

impl CircuitBreaker {
  fn new(failure_threshold: usize, recovery_success_needed: usize) -> Self {
    Self {
      failure_threshold,
      recovery_success_needed,
      consecutive_failures: 0,
      consecutive_recovery_successes: 0,
      open: false,
    }
  }

  fn on_failure(&mut self) {
    self.consecutive_failures += 1;
    self.consecutive_recovery_successes = 0;
    if self.consecutive_failures >= self.failure_threshold {
      self.open = true;
    }
  }

  fn on_success(&mut self) {
    self.consecutive_failures = 0;
    if self.open {
      self.consecutive_recovery_successes += 1;
      if self.consecutive_recovery_successes >= self.recovery_success_needed {
        self.open = false;
        self.consecutive_recovery_successes = 0;
      }
    }
  }
}

#[derive(Debug, Clone)]
struct MockClashApi {
  reachable: bool,
  outcomes: VecDeque<SelectOutcome>,
}

impl MockClashApi {
  fn new(reachable: bool, outcomes: Vec<SelectOutcome>) -> Self {
    Self {
      reachable,
      outcomes: outcomes.into(),
    }
  }

  fn health(&self) -> bool {
    self.reachable
  }

  fn switch_node(&mut self, _node: &str) -> SelectOutcome {
    self.outcomes.pop_front().unwrap_or(SelectOutcome::Failed)
  }
}

#[derive(Debug, Clone)]
struct ProxyOrchestrator {
  mode: RoutingMode,
  breaker: CircuitBreaker,
}

impl ProxyOrchestrator {
  fn new() -> Self {
    Self {
      mode: RoutingMode::Clash,
      breaker: CircuitBreaker::new(3, 2),
    }
  }

  fn detect_and_downgrade_if_needed(&mut self, api: &MockClashApi) {
    if !api.health() {
      self.mode = RoutingMode::Direct;
    }
  }

  fn try_switch_node(&mut self, api: &mut MockClashApi, node: &str) -> SelectOutcome {
    if self.breaker.open {
      return SelectOutcome::Failed;
    }

    let result = api.switch_node(node);
    match result {
      SelectOutcome::Success => {
        self.breaker.on_success();
        self.mode = RoutingMode::Clash;
      }
      SelectOutcome::Failed => {
        self.breaker.on_failure();
        if self.breaker.open {
          self.mode = RoutingMode::Direct;
        }
      }
    }

    result
  }

  fn try_recovery_probe(&mut self, api: &mut MockClashApi, node: &str) -> SelectOutcome {
    let result = api.switch_node(node);
    match result {
      SelectOutcome::Success => {
        self.breaker.on_success();
        if !self.breaker.open {
          self.mode = RoutingMode::Clash;
        }
      }
      SelectOutcome::Failed => {
        self.breaker.on_failure();
        self.mode = RoutingMode::Direct;
      }
    }
    result
  }
}

#[test]
fn degrades_to_direct_when_clash_api_unavailable() {
  let api = MockClashApi::new(false, vec![]);
  let mut orchestrator = ProxyOrchestrator::new();

  orchestrator.detect_and_downgrade_if_needed(&api);

  assert_eq!(orchestrator.mode, RoutingMode::Direct);
}

#[test]
fn node_switch_success_and_failure_paths() {
  let mut api = MockClashApi::new(true, vec![SelectOutcome::Success, SelectOutcome::Failed]);
  let mut orchestrator = ProxyOrchestrator::new();

  assert_eq!(
    orchestrator.try_switch_node(&mut api, "hk-1"),
    SelectOutcome::Success
  );
  assert_eq!(orchestrator.mode, RoutingMode::Clash);

  assert_eq!(
    orchestrator.try_switch_node(&mut api, "sg-2"),
    SelectOutcome::Failed
  );
  assert_eq!(orchestrator.mode, RoutingMode::Clash);
}

#[test]
fn circuit_breaker_trip_and_recovery_strategy() {
  let mut api = MockClashApi::new(
    true,
    vec![
      SelectOutcome::Failed,
      SelectOutcome::Failed,
      SelectOutcome::Failed,
      SelectOutcome::Success,
      SelectOutcome::Success,
    ],
  );
  let mut orchestrator = ProxyOrchestrator::new();

  assert_eq!(
    orchestrator.try_switch_node(&mut api, "n1"),
    SelectOutcome::Failed
  );
  assert_eq!(
    orchestrator.try_switch_node(&mut api, "n2"),
    SelectOutcome::Failed
  );
  assert!(!orchestrator.breaker.open);

  assert_eq!(
    orchestrator.try_switch_node(&mut api, "n3"),
    SelectOutcome::Failed
  );
  assert!(orchestrator.breaker.open);
  assert_eq!(orchestrator.mode, RoutingMode::Direct);

  assert_eq!(
    orchestrator.try_recovery_probe(&mut api, "recover-1"),
    SelectOutcome::Success
  );
  assert!(orchestrator.breaker.open);
  assert_eq!(orchestrator.mode, RoutingMode::Direct);

  assert_eq!(
    orchestrator.try_recovery_probe(&mut api, "recover-2"),
    SelectOutcome::Success
  );
  assert!(!orchestrator.breaker.open);
  assert_eq!(orchestrator.mode, RoutingMode::Clash);
}
