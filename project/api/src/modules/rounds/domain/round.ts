export enum RoundStatus {
  Open = 'OPEN',
  Closed = 'CLOSED',
}

export interface RoundState {
  providerId: string;
  roundId: string;
  status: RoundStatus;
  openedAt: Date;
  closedAt?: Date;
}

/** Rodada de um provedor; o primeiro resultado a fecha sem impedir resultados posteriores. */
export class Round {
  private constructor(
    public readonly providerId: string,
    public readonly roundId: string,
    private _status: RoundStatus,
    public readonly openedAt: Date,
    private _closedAt: Date | undefined,
  ) {}

  static open(providerId: string, roundId: string, at: Date): Round {
    return new Round(providerId, roundId, RoundStatus.Open, at, undefined);
  }

  static rehydrate(state: RoundState): Round {
    return new Round(state.providerId, state.roundId, state.status, state.openedAt, state.closedAt);
  }

  get status(): RoundStatus {
    return this._status;
  }

  get closedAt(): Date | undefined {
    return this._closedAt;
  }

  close(at: Date): boolean {
    if (this.isClosed()) {
      return false;
    }

    this._status = RoundStatus.Closed;
    this._closedAt = at;
    return true;
  }

  isClosed(): boolean {
    return this._status === RoundStatus.Closed;
  }
}
