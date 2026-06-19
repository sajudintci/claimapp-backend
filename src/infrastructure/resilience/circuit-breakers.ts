import { env } from "@/config/env";
import { CircuitBreaker } from "@/infrastructure/resilience/circuit-breaker";

function createBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker(name, {
    failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    resetTimeoutMs: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    halfOpenSuccessThreshold: env.CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
    enabled: env.CIRCUIT_BREAKER_ENABLED,
  });
}

/** ABBYY Vantage OCR API */
export const abbyyCircuitBreaker = createBreaker("abbyy");

/** OpenAI / compatible LLM API */
export const openaiCircuitBreaker = createBreaker("openai");
