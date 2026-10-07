import pytest

from app.services.memory_agent import _get_response_strategy

# Test data for candidates
CANDIDATE_SARA = {"name": "Sara", "relationship": "daughter"}
CANDIDATE_JOHN = {"name": "John", "relationship": ""}


def test_get_response_strategy_high_confidence():
    """Should return a confident identification strategy for high-tier matches."""
    strategy = _get_response_strategy(
        tier="high",
        is_recog_query=True,
        candidate=CANDIDATE_SARA,
        face_present=True,
    )
    assert strategy["identify"] is True
    assert strategy["shown_name"] == "Sara"
    assert "CONFIDENTLY recognized: Sara, your daughter" in strategy["visual"]
    assert "This is Sara, your daughter" in strategy["fallback"]


def test_get_response_strategy_medium_confidence_with_recog_query():
    """Should return a hedged identification for medium-tier matches when user asks."""
    strategy = _get_response_strategy(
        tier="medium",
        is_recog_query=True,
        candidate=CANDIDATE_JOHN,
        face_present=True,
    )
    assert strategy["identify"] is True
    assert strategy["shown_name"] == "John"
    assert "POSSIBLE match: John, but NOT certain" in strategy["visual"]
    assert "looks like John, but I'm not fully sure" in strategy["fallback"]


def test_get_response_strategy_medium_confidence_no_recog_query():
    """Should return a conversational strategy for medium-tier if user doesn't ask."""
    strategy = _get_response_strategy(
        tier="medium",
        is_recog_query=False,
        candidate=CANDIDATE_JOHN,
        face_present=True,
    )
    assert strategy["identify"] is False
    assert strategy["shown_name"] is None
    assert "Friendly conversation" in strategy["visual"]
    assert "Hello! I'm right here with you" in strategy["fallback"]


def test_get_response_strategy_low_confidence_with_recog_query_face_present():
    """Should state a face is seen but not recognized if tier is low but user asks."""
    strategy = _get_response_strategy(
        tier="low", is_recog_query=True, candidate=None, face_present=True
    )
    assert strategy["identify"] is True
    assert strategy["shown_name"] is None
    assert "A face was seen but is NOT confidently recognized" in strategy["visual"]
    assert "I'm not sure who that is yet" in strategy["fallback"]


def test_get_response_strategy_unknown_confidence_with_recog_query_no_face():
    """Should state no one is in view if no face is present but user asks."""
    strategy = _get_response_strategy(
        tier="unknown", is_recog_query=True, candidate=None, face_present=False
    )
    assert strategy["identify"] is True
    assert strategy["shown_name"] is None
    assert "No one is clearly in view" in strategy["visual"]
    assert "I'm not sure who that is yet" in strategy["fallback"]


def test_get_response_strategy_default_conversational():
    """Should return a generic conversational strategy when not a recognition query."""
    strategy = _get_response_strategy(
        tier="unknown", is_recog_query=False, candidate=None, face_present=False
    )
    assert strategy["identify"] is False
    assert strategy["shown_name"] is None
    assert "Friendly conversation" in strategy["visual"]
    assert "Hello! I'm right here with you" in strategy["fallback"]


def test_get_response_strategy_high_confidence_no_candidate_name():
    """Should fall back to 'not recognized' if candidate has no name, even on high tier."""
    strategy = _get_response_strategy(
        tier="high", is_recog_query=True, candidate={}, face_present=True
    )
    # Falls through because _who(candidate) is None
    assert strategy["identify"] is True
    assert strategy["shown_name"] is None
    assert "A face was seen but is NOT confidently recognized" in strategy["visual"]
    assert "I'm not sure who that is yet" in strategy["fallback"]