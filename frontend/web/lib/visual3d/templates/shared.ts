// Schemas shared by several templates (with descriptions the LLM reads).
import { z } from "zod/v4";
export const Vec3S = z.tuple([z.number(), z.number(), z.number()]).describe("A 3-D vector [x, y, z]; each component from -10 to 10.")
  .refine((v) => v.every((c) => Math.abs(c) <= 10), "each component must be between -10 and 10");
export const Matrix3S = z.array(z.array(z.number().min(-5).max(5)).length(3)).length(3).describe("A 3×3 matrix as rows, entries from -5 to 5, e.g. [[1,0,0],[0,2,0],[0,0,1]].");
export const IntKey = z.number().int().min(-999).max(999);
