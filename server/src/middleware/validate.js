import { param, validationResult } from 'express-validator';
import { ApiError } from '../utils/http.js';

/** Run express-validator chains and return a 422 with field errors. */
export const validate = (req, _res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array().map((e) => ({ field: e.path, message: e.msg }));
  next(new ApiError(422, errors[0]?.message || 'Validation failed', errors));
};

export const idParam = (...names) => [...names.map((n) => param(n, 'Invalid id').isMongoId()), validate];
