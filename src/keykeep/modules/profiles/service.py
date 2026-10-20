from sqlalchemy.ext.asyncio import AsyncSession

from keykeep.models import User
from keykeep.modules.profiles.schemas import ProfileUpdate


async def update_profile(db: AsyncSession, user: User, data: ProfileUpdate):
    user.profile.first_name = data.first_name.strip() or "Странник"
    await db.commit()
    return user.profile
