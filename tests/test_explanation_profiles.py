from app.explainers.profile_loader import profile_loader


def test_priority_profiles_are_available():
    for name in ("storage_dispatch", "pv_storage_day_ahead_dispatch", "pv_storage_intraday_dispatch", "contract_spot_exposure", "retail_da_spot_bidding"):
        profile = profile_loader.load(name)
        assert profile and profile["profile_name"] == name
        assert profile.get("manual_review_points")
