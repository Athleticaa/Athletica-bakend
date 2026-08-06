import { Request, Response } from "express";
import { injectable, container } from "tsyringe";
import { NutritionService } from "./nutrition.service";
import { ServiceError } from "../../lib/service-error";
import { parseListFoodsQuery } from "./nutrition.validation";

@injectable()
export class NutritionController {
  private service: NutritionService;

  constructor() {
    this.service = container.resolve(NutritionService);
  }

  private handleError(res: Response, err: unknown) {
    if (err instanceof ServiceError) {
      const t = (res.req as Request).t || ((s: string) => s);
      res.status(err.statusCode).json({ error: t(err.messageKey) });
      return;
    }
    console.error("unexpected error:", err);
    const t = (res.req as Request).t || ((s: string) => s);
    res.status(500).json({ error: t("internal_server_error") });
  }

  listFoods = async (req: Request, res: Response) => {
    const { result, errors } = parseListFoodsQuery(req.query, req.t);
    if (!result) {
      res.status(400).json({ error: req.t("validation_failed"), details: errors });
      return;
    }

    try {
      const data = await this.service.listFoods(result);
      res.status(200).json(data);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  getFood = async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const food = await this.service.getFood(id);
      res.status(200).json({ food });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  listFoodCategories = async (_req: Request, res: Response) => {
    try {
      const categories = await this.service.listFoodCategories();
      res.status(200).json({ categories });
    } catch (err) {
      this.handleError(res, err);
    }
  };
}
