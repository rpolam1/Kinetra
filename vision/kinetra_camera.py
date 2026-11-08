import os
import sys
import traceback

from formcheck.paths import FROZEN, user_data_dir


def main():
    if FROZEN:
        os.chdir(user_data_dir())  # templates and the cached hub address live here
    import client
    try:
        client.main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc()
        if FROZEN and sys.stdin and sys.stdin.isatty():
            input("\nSomething went wrong (details above). Press Enter to close.")
        sys.exit(1)


if __name__ == "__main__":
    main()
