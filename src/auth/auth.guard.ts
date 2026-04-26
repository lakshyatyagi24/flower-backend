import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload, verifyJwt } from './jwt.util';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'CUSTOMER' | 'ADMIN'>) =>
  SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = auth.slice(7).trim();
    const payload = verifyJwt(token);
    if (!payload) throw new UnauthorizedException('Invalid or expired token');
    req.user = payload;

    const requiredRoles = this.reflector.getAllAndOverride<Array<'CUSTOMER' | 'ADMIN'>>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(payload.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = req.headers['authorization'];
    if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      const payload = verifyJwt(auth.slice(7).trim());
      if (payload) req.user = payload;
    }
    return true;
  }
}
