# Authentication Module

#decl module authentication
  Covers all authentication and authorization requirements
  for the platform.

  #decl section password-policy
    Rules governing password strength and rotation.

    #decl requirement min-password-length
      Passwords MUST be at least 12 characters long.
      This applies to all user-created passwords, not
      system-generated tokens.
    #end

    #decl requirement password-complexity
      Passwords MUST contain at least:
      - One uppercase letter
      - One lowercase letter  
      - One digit
      - One special character from: !@#$%^&*
    #end

    #decl example weak-password-rejected
      Input: "short1!"
      Expected: Rejected — under 12 characters.
    #end

    #decl example strong-password-accepted
      Input: "MyS3cure!Pass2026"
      Expected: Accepted — meets all criteria.
    #end

  #end

  #decl section session-management
    Rules for session lifecycle and timeout.

    #decl requirement session-timeout
      Sessions MUST expire after 30 minutes of inactivity.
      A warning MUST be shown 5 minutes before expiry.
    #end

    #decl requirement concurrent-sessions
      Users MAY have at most 3 concurrent sessions.
      Creating a 4th session MUST invalidate the oldest one.
    #end

    #decl example session-expires-after-inactivity
      Given a user logged in at 10:00.
      When no activity occurs until 10:31.
      Then session is expired and user is redirected to login.
    #end

  #end

#end
