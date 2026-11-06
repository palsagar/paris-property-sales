import { Router, type IRouter } from "express";
import {
  GetArrondissementBoundariesResponse,
  GetCommuneBoundariesResponse,
  GetQuartierBoundariesResponse,
} from "@workspace/api-zod";
import { arrondissementGeo, communeGeo, quartierGeo } from "../lib/salesData";

const router: IRouter = Router();

router.get("/geo/arrondissements", (_req, res): void => {
  res.json(GetArrondissementBoundariesResponse.parse(arrondissementGeo));
});

router.get("/geo/quartiers", (_req, res): void => {
  res.json(GetQuartierBoundariesResponse.parse(quartierGeo));
});

router.get("/geo/communes", (_req, res): void => {
  res.json(GetCommuneBoundariesResponse.parse(communeGeo));
});

export default router;
