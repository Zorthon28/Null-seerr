import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDismissedRecommendations1727100000000
  implements MigrationInterface
{
  name = 'AddDismissedRecommendations1727100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "dismissed_recommendation" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "mediaType" varchar NOT NULL,
        "title" varchar NOT NULL DEFAULT '',
        "tmdbId" integer NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UNIQUE_USER_DISMISSED" UNIQUE ("tmdbId", "mediaType", "userId"),
        CONSTRAINT "FK_dismissed_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
      )`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dismissed_tmdbId" ON "dismissed_recommendation" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dismissed_userId" ON "dismissed_recommendation" ("userId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dismissed_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dismissed_tmdbId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dismissed_recommendation"`);
  }
}
