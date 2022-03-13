require "irb/completion"
require "irb/ext/save-history"

IRB.conf[:SAVE_HISTORY] = 25
IRB.conf[:HISTORY_FILE] = "#{ENV["HOME"]}/.irb-history"
IRB.conf[:AUTO_INDENT] = true
IRB.conf[:PROMPT_MODE] = :SIMPLE

class Object
  def dbg
    self.tap do |x|
      puts ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>"
      puts x.inspect
      puts "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
    end
  end
end

# Add color coding based on Rails environment for safety

if defined? Rails
  banner = if Rails.env.production?
    "\e[41;97;1m #{Rails.env} \e[0m "
  else
    "\e[42;97;1m #{Rails.env} \e[0m "
  end

  # Build a custom prompt
  IRB.conf[:PROMPT][:CUSTOM] = IRB.conf[:PROMPT][:DEFAULT].merge(
    PROMPT_I: banner + IRB.conf[:PROMPT][:DEFAULT][:PROMPT_I],
  )

  # Use custom prompt by default
  IRB.conf[:PROMPT_MODE] = :CUSTOM
end
