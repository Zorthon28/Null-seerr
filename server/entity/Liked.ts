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

export class DuplicateLikedError extends Error {
  constructor(message = 'Item is already in liked list') {
    super(message);
    this.name = 'DuplicateLikedError';
  }
}

export class LikedNotFoundError extends Error {
  constructor(message = 'Liked item not found') {
    super(message);
    this.name = 'LikedNotFoundError';
  }
}

@Entity()
@Unique('UNIQUE_USER_LIKED', ['tmdbId', 'mediaType', 'userId'])
export class Liked {
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

  @ManyToOne(() => User, (user) => user.liked, {
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

  constructor(init?: Partial<Liked>) {
    Object.assign(this, init);
  }

  public static async createLiked({
    tmdbId,
    mediaType,
    title,
    user,
  }: {
    tmdbId: number;
    mediaType: MediaType;
    title?: string;
    user: User;
  }): Promise<Liked> {
    const likedRepository = getRepository(Liked);
    const mediaRepository = getRepository(Media);

    const existing = await likedRepository.findOne({
      where: {
        tmdbId,
        mediaType,
        userId: user.id,
      },
    });

    if (existing) {
      logger.warn('Duplicate liked item blocked', {
        tmdbId,
        mediaType,
        userId: user.id,
        label: 'Liked',
      });
      throw new DuplicateLikedError();
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
        logger.warn('Could not fetch TMDB metadata when liking title', {
          tmdbId,
          mediaType,
          errorMessage: (err as Error).message,
        });
      }
    }

    const liked = new Liked({
      tmdbId,
      mediaType,
      title: resolvedTitle,
      user,
      userId: user.id,
      media: media || undefined,
    });

    return await likedRepository.save(liked);
  }

  public static async deleteLiked(
    tmdbId: number,
    mediaType: MediaType,
    user: User
  ): Promise<void> {
    const likedRepository = getRepository(Liked);
    const liked = await likedRepository.findOne({
      where: {
        tmdbId,
        mediaType,
        userId: user.id,
      },
    });

    if (!liked) {
      throw new LikedNotFoundError();
    }

    await likedRepository.delete(liked.id);
  }
}

export default Liked;
