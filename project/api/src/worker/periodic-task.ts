import { Logger } from '@nestjs/common';

/**
 * Executa `run` a cada `intervalMs`, sem sobrepor execuções; `stop` espera a execução em andamento,
 * para o shutdown não cortar uma transação no meio (stop_grace_period de 30 s).
 */
export class PeriodicTask {
  private readonly logger: Logger;
  private timer: ReturnType<typeof setInterval> | undefined;
  private current: Promise<void> | undefined;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly run: () => Promise<void>,
  ) {
    this.logger = new Logger(name);
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.current;
  }

  private tick(): void {
    if (this.current) {
      return;
    }

    this.current = this.run()
      .catch((error: unknown) => {
        this.logger.error(
          { message: 'Periodic task failed', task: this.name },
          error instanceof Error ? error.stack : String(error),
        );
      })
      .finally(() => {
        this.current = undefined;
      });
  }
}
