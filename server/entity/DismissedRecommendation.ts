import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
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

export class DuplicateDismissedError extends Error {
  constructor(message = 'Recommendation is already dismissed') {
    super(message);
    this.name = 'DuplicateDismissedError';
  }
}

export class DismissedNotFoundError extends Error {
  constructor(message = 'Dismissed recommendation not found') {
    super(message);
    this.name = 'DismissedNotFoundError';
  }
}

@Entity('dismissed_recommendation')
@Unique('UNIQUE_USER_DISMISSED', ['tmdbId', 'mediaType', 'userId'])
export class DismissedRecommendation {
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

  @ManyToOne(() => User, {
    eager: false,
    onDelete: 'CASCADE',
  })
  public user: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<DismissedRecommendation>) {
    Object.assign(this, init);
  }

  public static async dismiss({
    tmdbId,
    mediaType,
    title,
    user,
  }: {
    tmdbId: number;
    mediaType: MediaType;
    title?: string;
    user: User;
  }): Promise<DismissedRecommendation> {
    const repo = getRepository(DismissedRecommendation);

    const existing = await repo.findOne({
      where: {
        tmdbId,
        mediaType,
        userId: user.id,
      },
    });

    if (existing) {
      return existing;
    }

    const entry = new DismissedRecommendation({
      tmdbId,
      mediaType,
      title: title || '',
      userId: user.id,
      user,
    });

    await repo.save(entry);
    logger.info('Recommendation dismissed', {
      tmdbId,
      mediaType,
      userId: user.id,
      title,
      label: 'Recommendations',
    });

    return entry;
  }

  public static async undismiss({
    tmdbId,
    mediaType,
    userId,
  }: {
    tmdbId: number;
    mediaType?: MediaType;
    userId: number;
  }): Promise<void> {
    const repo = getRepository(DismissedRecommendation);
    const where: any = { tmdbId, userId };
    if (mediaType) {
      where.mediaType = mediaType;
    }

    const result = await repo.delete(where);
    if (!result.affected) {
      throw new DismissedNotFoundError();
    }

    logger.info('Dismissed recommendation restored', {
      tmdbId,
      mediaType,
      userId,
      label: 'Recommendations',
    });
  }
}
