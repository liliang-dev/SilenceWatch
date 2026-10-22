import pytest

from silencewatch.cron import compact, is_supported


@pytest.mark.parametrize(
    "expression",
    ["0 2 * * *", "*/5 * * * *", "0 0 2 * * *", "@daily", "@hourly", "0 9 * * mon-fri", "0 0 L * *"],
)
def test_accepts_what_the_server_can_evaluate(expression):
    assert is_supported(expression)


@pytest.mark.parametrize(
    "expression", [None, "", "  ", "* * *", "@reboot", "0 0 15W * *", "0 0 LW * *", "a b c d e f g"]
)
def test_refuses_what_it_cannot(expression):
    assert not is_supported(expression)


@pytest.mark.parametrize(
    ("values", "low", "high", "written"),
    [
        (range(0, 60), 0, 59, "*"),
        ([0], 0, 59, "0"),
        ([0, 15, 30, 45], 0, 59, "*/15"),
        ([0, 30], 0, 59, "0,30"),
        ([9, 10, 11, 12, 13, 14, 15, 16, 17], 0, 23, "9-17"),
        ([1, 2, 3, 4, 5], 0, 6, "1-5"),
        ([5, 6], 0, 6, "5,6"),
        ([0, 6], 0, 6, "0,6"),
        ([1, 3, 5, 7, 8, 9], 0, 59, "1,3,5,7-9"),
        ([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], 0, 23, "*/2"),
        (range(1, 13), 1, 12, "*"),
        ([2], 0, 23, "2"),
    ],
)
def test_writes_a_set_of_numbers_as_one_cron_field(values, low, high, written):
    assert compact(values, low, high) == written


def test_an_empty_field_is_an_error():
    with pytest.raises(ValueError, match="empty"):
        compact([], 0, 59)
