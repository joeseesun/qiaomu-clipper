import type { Publisher } from './types';
import { xPublisher } from './x';

export const publishers: Publisher[] = [xPublisher];
export type { Publisher, PublishRequest } from './types';
