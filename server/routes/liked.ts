import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import {
  DuplicateLikedError,
  Liked,
  LikedNotFoundError,
} from '@server/entity/Liked';
import logger from '@server/logger';
import { Router } from 'express';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

const likedRoutes = Router();

const likedCreateSchema = z.object({
  tmdbId: z.number(),
  mediaType: z.nativeEnum(MediaType),
  title: z.string().optional(),
});

// GET /api/v1/liked/ids — return all liked tmdbIds for the logged-in user
likedRoutes.get('/ids', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to view liked items.',
    });
  }

  try {
    const likedRepo = getRepository(Liked);
    const items = await likedRepo.find({
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

// POST /api/v1/liked — add title to liked
likedRoutes.post('/', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to like items.',
    });
  }

  try {
    const values = likedCreateSchema.parse(req.body);

    const liked = await Liked.createLiked({
      tmdbId: values.tmdbId,
      mediaType: values.mediaType,
      title: values.title,
      user: req.user,
    });

    return res.status(201).json(liked);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next({ status: 400, message: error.message });
    }
    if (error instanceof DuplicateLikedError) {
      return next({ status: 409, message: error.message });
    }
    if (error instanceof QueryFailedError) {
      logger.warn('Error saving liked item', {
        tmdbId: req.body.tmdbId,
        mediaType: req.body.mediaType,
        label: 'Liked',
      });
      return next({
        status: 409,
        message: 'Item already exists or conflict occurred',
      });
    }
    return next({ status: 500, message: (error as Error).message });
  }
});

// DELETE /api/v1/liked/:tmdbId — remove title from liked
likedRoutes.delete('/:tmdbId', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to remove liked items.',
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

    await Liked.deleteLiked(
      Number(req.params.tmdbId),
      mediaType,
      req.user
    );

    return res.status(204).send();
  } catch (error) {
    if (error instanceof LikedNotFoundError) {
      return next({
        status: 404,
        message: error.message,
      });
    }
    return next({ status: 500, message: (error as Error).message });
  }
});

export default likedRoutes;
