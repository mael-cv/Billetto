import type { Pagination } from './validation/schemas';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function toPage<T>(items: T[], total: number, pagination: Pagination): Page<T> {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
  };
}

export const offsetOf = (pagination: Pagination): number => (pagination.page - 1) * pagination.pageSize;
