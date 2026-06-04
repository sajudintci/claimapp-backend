import bcrypt from "bcrypt";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { env } from "@/config/env";
import { RefreshTokenModel } from "@/database/models/refresh-token.model";
import { UserModel } from "@/database/models/user.model";
import { createId } from "@/utils/id";

export class AuthService {
  async login(email: string, password: string) {
    const user = await UserModel.findOne({ where: { email, isActive: true } });
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    const accessToken = jwt.sign(
      { sub: user.id, org: user.organizationId, email: user.email },
      env.JWT_SECRET as Secret,
      { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN } as SignOptions
    );

    const refreshToken = jwt.sign(
      { sub: user.id },
      env.JWT_REFRESH_SECRET as Secret,
      { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN } as SignOptions
    );

    await RefreshTokenModel.create(
      {
        id: createId(),
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      } as any
    );

    return { accessToken, refreshToken, user };
  }

  async refresh(token: string) {
    const existing = await RefreshTokenModel.findOne({ where: { token } });
    if (!existing) return null;

    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET as Secret) as { sub: string };
    const user = await UserModel.findByPk(payload.sub);
    if (!user) return null;

    const accessToken = jwt.sign(
      { sub: user.id, org: user.organizationId, email: user.email },
      env.JWT_SECRET as Secret,
      { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN } as SignOptions
    );

    return { accessToken };
  }

  async logout(token: string) {
    await RefreshTokenModel.destroy({ where: { token } });
  }
}
