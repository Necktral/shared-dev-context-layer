from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine


def check_database_connection() -> tuple[bool, str | None]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as exc:
        return False, str(exc)
