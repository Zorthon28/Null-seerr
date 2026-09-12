import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatched1726000000000 implements MigrationInterface {
  name = 'AddWatched1726000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "watched" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "mediaType" varchar NOT NULL,
        "title" varchar NOT NULL DEFAULT '',
        "tmdbId" integer NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        "mediaId" integer,
        CONSTRAINT "UNIQUE_USER_WATCHED" UNIQUE ("tmdbId", "mediaType", "userId"),
        CONSTRAINT "FK_watched_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_watched_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE
      )`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_watched_tmdbId" ON "watched" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_watched_userId" ON "watched" ("userId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_watched_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_watched_tmdbId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "watched"`);
  }
}
