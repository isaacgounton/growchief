export interface ProxyProviderInterface<T> {
  identifier: string;
  label: string;
  countryList(): Promise<{ identifier: string; label: string }[]>;
  createProxy(
    country: string,
  ): Promise<{ ip: string; username: string; password: string; data: T }>;
  deleteProxy(ip: string, data: T): Promise<any>;
  getAllIps(): Promise<{ ip: string; data: any }[]>;
  connectURL(): string;
  whiteListIp?(data: any): Promise<any>;
}
