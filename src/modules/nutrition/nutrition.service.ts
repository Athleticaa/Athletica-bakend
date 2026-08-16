// Re-export from split services for backward compatibility
export { FoodService, type IFoodService } from "./food.service";
export { NutritionTemplateService, type INutritionTemplateService } from "./nutrition-template.service";
export {
  buildPagination,
  paginate,
  toDateOnly,
  todayDateOnly,
  formatDateOnly,
  parseDateOnly,
  daysBetween,
  addDays,
  type PaginationMeta,
} from "./nutrition.utils";

// Legacy re-export: ServiceError if any consumer imports it from here
export { ServiceError } from "../../lib/service-error";
