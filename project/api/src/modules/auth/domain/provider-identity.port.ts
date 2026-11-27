/** Porta de domínio para autorizar a identidade do provedor nas entradas HTTP e SQS. */
export abstract class ProviderIdentityPort {
  /**
   * A checagem de posse deve comparar o providerId da rota ou mensagem com a identidade autenticada.
   * No HTTP, essa identidade virá da claim providerId do token; no SQS, o canal interno é confiável,
   * mas o providerId da mensagem continua sujeito às validações de domínio.
   *
   * @throws ProviderNotAllowedError quando a identidade não puder agir pelo provedor informado.
   */
  abstract assertCanActAs(providerId: string, channel: 'http' | 'sqs'): void;
}
