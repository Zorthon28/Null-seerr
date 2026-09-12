import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import {
  DuplicateWatchedError,
  Watched,
  WatchedNotFoundError,
} from '@server/entity/Watched';
import logger from '@server/logger';
import { Router } from 'express';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

const watchedRoutes = Router();

const watchedCreateSchema = z.object({
  tmdbId: z.number(),
  mediaType: z.nativeEnum(MediaType),
  title: z.string().optional(),
});

// GET /api/v1/watched/ids — return all watched tmdbIds for the logged-in user
watchedRoutes.get('/ids', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to view watched items.',
    });
  }

  try {
    const watchedRepo = getRepository(Watched);
    const items = await watchedRepo.find({
      where: { userId: req.user.id },
      select: ['tmdbId', 'mediaType'],
    });

    return res.status(200).json({
      results: items.map((i) => ({
        tmdbId: i.tmdbId,
        mediaType: i.mediaType,
      })),
    });
  } catch (error) {
    return next({ status: 500, message: (error as Error).message });
  }
});

// POST /api/v1/watched — mark title as watched
watchedRoutes.post('/', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to mark items as watched.',
    });
  }

  try {
    const values = watchedCreateSchema.parse(req.body);

    const watched = await Watched.createWatched({
      tmdbId: values.tmdbId,
      mediaType: values.mediaType,
      title: values.title,
      user: req.user,
    });

    return res.status(201).json(watched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next({ status: 400, message: error.message });
    }
    if (error instanceof DuplicateWatchedError) {
      return next({ status: 409, message: error.message });
    }
    if (error instanceof QueryFailedError) {
      logger.warn('Error saving watched item', {
        tmdbId: req.body.tmdbId,
        mediaType: req.body.mediaType,
        label: 'Watched',
      });
      return next({ status: 409, message: 'Item already exists or conflict occurred' });
    }
    return next({ status: 500, message: (error as Error).message });
  }
});

// DELETE /api/v1/watched/:tmdbId — unmark title as watched
watchedRoutes.delete('/:tmdbId', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to remove watched items.',
    });
  }

  try {
    const mediaType = req.query.mediaType as MediaType;
    if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
      return next({
        status: 400,
        message: 'Invalid mediaType query parameter.',
      });
    }

    await Watched.deleteWatched(
      Number(req.params.tmdbId),
      mediaType,
      req.user
    );

    return res.status(204).send();
  } catch (error) {
    if (error instanceof WatchedNotFoundError) {
      return next({
        status: 404,
        message: error.message,
      });
    }
    return next({ status: 500, message: (error as Error).message });
  }
});

export default watchedRoutes;
