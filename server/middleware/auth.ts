import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  Permission,
  PermissionCheckOptions,
} from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export const checkUser: Middleware = async (req, _res, next) => {
  const settings = getSettings();
  let user: User | undefined | null;

  if (req.header('X-API-Key') === settings.main.apiKey) {
    const userRepository = getRepository(User);

    let userId = 1; // Work on original administrator account

    // If a User ID is provided, we will act on that user's behalf
    if (req.header('X-API-User')) {
      userId = Number(req.header('X-API-User'));
    }

    user = await userRepository.findOne({ where: { id: userId } });
  } else if (req.session?.userId) {
    const userRepository = getRepository(User);

    user = await userRepository.findOne({
      where: { id: req.session.userId },
    });
  }

  // Cloudflare Access Zero Trust & Reverse Proxy SSO Auto-Authentication
  if (!user) {
    const ssoHeader =
      req.header('cf-access-authenticated-user-email') ||
      req.header('x-forwarded-email') ||
      req.header('remote-email') ||
      req.header('remote-user');

    if (ssoHeader && typeof ssoHeader === 'string' && ssoHeader.trim()) {
      const ssoEmail = ssoHeader.trim().toLowerCase();
      const userRepository = getRepository(User);

      // Check if user exists by email or username
      user = await userRepository
        .createQueryBuilder('user')
        .where('LOWER(user.email) = :email OR LOWER(user.username) = :email', {
          email: ssoEmail,
        })
        .getOne();

      // If user not found, check if this is the primary user / admin (e.g. dev.gustavo.tello@gmail.com)
      if (!user) {
        const adminUser = await userRepository.findOne({ where: { id: 1 } });
        if (
          adminUser &&
          (ssoEmail === 'dev.gustavo.tello@gmail.com' ||
            adminUser.email.toLowerCase() === 'admin@nullseerr.local')
        ) {
          user = adminUser;
          if (adminUser.email.toLowerCase() !== ssoEmail) {
            adminUser.email = ssoEmail;
            await userRepository.save(adminUser);
            logger.info(
              `Associated primary admin account with Cloudflare SSO email: ${ssoEmail}`,
              { label: 'Auth' }
            );
          }
        } else if (ssoEmail.includes('@')) {
          // Auto-provision standard user with default permissions
          const newUser = new User({
            email: ssoEmail,
            username: ssoEmail.split('@')[0],
            permissions: settings.main.defaultPermissions,
            userType: UserType.LOCAL,
            avatar: '',
          });
          await newUser.generatePassword();
          user = await userRepository.save(newUser);
          logger.info(
            `Auto-provisioned new user for Cloudflare SSO: ${ssoEmail}`,
            { label: 'Auth' }
          );
        }
      }

      if (user && req.session) {
        req.session.userId = user.id;
      }
    }
  }

  if (user) {
    req.user = user;
  }

  req.locale = user?.settings?.locale
    ? user.settings.locale
    : settings.main.locale;

  next();
};

export const isAuthenticated = (
  permissions?: Permission | Permission[],
  options?: PermissionCheckOptions
): Middleware => {
  const authMiddleware: Middleware = (req, res, next) => {
    if (!req.user || !req.user.hasPermission(permissions ?? 0, options)) {
      res.status(403).json({
        status: 403,
        error: 'You do not have permission to access this endpoint',
      });
    } else {
      next();
    }
  };
  return authMiddleware;
};
