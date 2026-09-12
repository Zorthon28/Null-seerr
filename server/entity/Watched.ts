import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export class DuplicateWatchedError extends Error {
  constructor(message = 'Item is already marked as watched') {
    super(message);
    this.name = 'DuplicateWatchedError';
  }
}

export class WatchedNotFoundError extends Error {
  constructor(message = 'Watched item not found') {
    super(message);
    this.name = 'WatchedNotFoundError';
  }
}

@Entity()
@Unique('UNIQUE_USER_WATCHED', ['tmdbId', 'mediaType', 'userId'])
export class Watched {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'varchar', default: '' })
  title = '';

  @Column()
  @Index()
  public tmdbId: number;

  @Column()
  @Index()
  public userId: number;

  @ManyToOne(() => User, (user) => user.watched, {
    eager: true,
    onDelete: 'CASCADE',
  })
  public user: User;

  @ManyToOne(() => Media, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @Index()
  public media?: Media | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Watched>) {
    Object.assign(this, init);
  }

  public static async createWatched({
    tmdbId,
    mediaType,
    title,
    user,
  }: {
    tmdbId: number;
    mediaType: MediaType;
    title?: string;
    user: User;
  }): Promise<Watched> {
    const watchedRepository = getRepository(Watched);
    const mediaRepository = getRepository(Media);

    const existing = await watchedRepository.findOne({
      where: {
        tmdbId,
        mediaType,
        userId: user.id,
      },
    });

    if (existing) {
      logger.warn('Duplicate watched item blocked', {
        tmdbId,
        mediaType,
        userId: user.id,
        label: 'Watched',
      });
      throw new DuplicateWatchedError();
    }

    let media = await mediaRepository.findOne({
      where: {
        tmdbId,
        mediaType,
      },
    });

    let resolvedTitle = title || '';

    if (!media) {
      try {
        const tmdb = new TheMovieDb();
        const tmdbMedia =
          mediaType === MediaType.MOVIE
            ? await tmdb.getMovie({ movieId: tmdbId })
            : await tmdb.getTvShow({ tvId: tmdbId });

        if (!resolvedTitle) {
          resolvedTitle =
            mediaType === MediaType.MOVIE
              ? (tmdbMedia as any).title
              : (tmdbMedia as any).name;
        }

        media = new Media({
          tmdbId,
          tvdbId: tmdbMedia.external_ids?.tvdb_id,
          mediaType,
        });
        await mediaRepository.save(media);
      } catch (err) {
        logger.warn('Could not fetch TMDB metadata when marking watched', {
          tmdbId,
          mediaType,
          errorMessage: (err as Error).message,
        });
      }
    }

    const watched = new Watched({
      tmdbId,
      mediaType,
      title: resolvedTitle,
      user,
      userId: user.id,
      media: media || undefined,
    });

    return await watchedRepository.save(watched);
  }

  public static async deleteWatched(
    tmdbId: number,
    mediaType: MediaType,
    user: User
  ): Promise<void> {
    const watchedRepository = getRepository(Watched);
    const watched = await watchedRepository.findOne({
      where: {
        tmdbId,
        mediaType,
        userId: user.id,
      },
    });

    if (!watched) {
      throw new WatchedNotFoundError();
    }

    await watchedRepository.delete(watched.id);
  }
}

export default Watched;
